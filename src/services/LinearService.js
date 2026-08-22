/**
 * Linear Service
 * Service for interacting with the Linear GraphQL API
 *
 * Read-only: queries projects and issues. Nothing in brickomations writes to
 * Linear (Linear writes stay manual / skill-gated on the vault side).
 *
 * @layer 1 - Integration (API-Specific)
 */

const axios = require("axios");

const PAGE_SIZE = 100;

class LinearService {
  constructor() {
    this.apiKey = process.env.LINEAR_API_KEY;

    if (!this.apiKey) {
      throw new Error("LINEAR_API_KEY is required");
    }

    this.client = axios.create({
      baseURL: "https://api.linear.app",
      headers: {
        // Personal API keys are sent bare (no "Bearer" prefix).
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a GraphQL query. Retries once on 429 (honoring Retry-After),
   * throws on transport or GraphQL-level errors — fail loud, never partial.
   */
  async graphql(query, variables = {}) {
    let response;
    try {
      response = await this.client.post("/graphql", { query, variables });
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers["retry-after"]) || 30;
        await this._sleep(retryAfter * 1000);
        response = await this.client.post("/graphql", { query, variables });
      } else {
        const detail = error.response?.data?.errors?.[0]?.message || error.message;
        throw new Error(`Linear API request failed: ${detail}`);
      }
    }

    if (response.data.errors?.length) {
      throw new Error(
        `Linear GraphQL error: ${response.data.errors.map((e) => e.message).join("; ")}`
      );
    }

    return response.data.data;
  }

  /** The authenticated user (whose assigned issues we pull). */
  async getViewer() {
    const data = await this.graphql(`query { viewer { id name email } }`);
    return data.viewer;
  }

  /** Resolve team keys (e.g. from LINEAR_PROJECT_TEAM_KEYS) to teams. */
  async getTeamsByKey(teamKeys) {
    const data = await this.graphql(
      `query TeamsByKey($keys: [String!]!) {
        teams(filter: { key: { in: $keys } }, first: 50) {
          nodes { id key name }
        }
      }`,
      { keys: teamKeys }
    );
    return data.teams.nodes;
  }

  /**
   * All projects for a team in the given states (e.g. started, planned).
   * Members are fetched only as IDs — enough to derive the viewer's role.
   */
  async getTeamProjects(teamId, states) {
    const nodes = [];
    let after = null;

    do {
      const data = await this.graphql(
        `query TeamProjects($teamId: String!, $states: [String!]!, $first: Int!, $after: String) {
          team(id: $teamId) {
            projects(first: $first, after: $after, filter: { state: { in: $states } }) {
              nodes {
                id
                name
                url
                description
                state
                status { name }
                priorityLabel
                lead { id name }
                members(first: 100) { nodes { id } }
                labels(first: 25) { nodes { name } }
                startDate
                targetDate
                startedAt
                updatedAt
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { teamId, states, first: PAGE_SIZE, after }
      );
      const page = data.team.projects;
      nodes.push(...page.nodes);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);

    return nodes;
  }

  /**
   * Projects the given user leads or is a member of — any state, any team.
   * Feeds the Notion 2026 Projects upsert (the caller scopes to the
   * configured teams; a Linear project has a teams *list*, so that check
   * is client-side). Deliberately unfiltered by state so backlog and
   * completed projects land too (Gone then means only archived-or-removed).
   * Slim node: only the fields the Notion leg writes, plus team keys.
   * description is the short summary metadata line; content is the project
   * overview document as markdown — both land in Notion (Description
   * property / page body).
   */
  async getAssignedProjects(userId) {
    const filter = {
      or: [
        { lead: { id: { eq: userId } } },
        { members: { some: { id: { eq: userId } } } },
      ],
    };

    const nodes = [];
    let after = null;

    do {
      const data = await this.graphql(
        `query AssignedProjects($filter: ProjectFilter!, $first: Int!, $after: String) {
          projects(first: $first, after: $after, filter: $filter) {
            nodes {
              id
              name
              url
              description
              content
              state
              priorityLabel
              startDate
              targetDate
              teams(first: 10) { nodes { key } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { filter, first: PAGE_SIZE, after }
      );
      const page = data.projects;
      nodes.push(...page.nodes);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);

    return nodes;
  }

  /**
   * Issues assigned to the authenticated user, any team, every state.
   * Completed and canceled issues only within the given cutoff window (ISO
   * datetime) — older ones fall out of the cache. Canceled issues are kept
   * so the Notion sync can mark them 🛑 Canceled rather than 🫥 Gone.
   */
  async getAssignedIssues(completedCutoff) {
    const filter = {
      or: [
        { and: [{ completedAt: { null: true } }, { canceledAt: { null: true } }] },
        { completedAt: { gt: completedCutoff } },
        { canceledAt: { gt: completedCutoff } },
      ],
    };

    const nodes = [];
    let after = null;

    do {
      const data = await this.graphql(
        `query AssignedIssues($filter: IssueFilter!, $first: Int!, $after: String) {
          viewer {
            assignedIssues(first: $first, after: $after, filter: $filter) {
              nodes {
                identifier
                title
                url
                dueDate
                priorityLabel
                completedAt
                canceledAt
                state { name type }
                assignee { name }
                project { name }
                team { key }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { filter, first: PAGE_SIZE, after }
      );
      const page = data.viewer.assignedIssues;
      nodes.push(...page.nodes);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);

    return nodes;
  }
}

module.exports = LinearService;
