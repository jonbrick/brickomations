# Notion Database Schema Reference

This document contains the exact property names, types, and allowed values for every Notion database in Jon's Life OS. Use these property names exactly when querying or creating pages.

## 2026 High Level Goals

Formerly "2026 Themes" (renamed 2026-11-11).

| Property | Type | Values |
|----------|------|--------|
| Name | title | |
| Category | select | "💼 Work", "🌱 Personal", "🍻 Interpersonal", "🏃 Physical", "❤️ Mental/Emotional", "🏠 Home" |
| Description | text | |
| 🌄 2026 Goals | relation | → Goals database |

## 2026 Goal Themes

| Property | Type | Values |
|----------|------|--------|
| Theme | title | |
| 🌄 2026 Goals | relation | → Goals database |

## 2026 Goals

| Property | Type | Values |
|----------|------|--------|
| Name | title | |
| Status | status | "🧊 Ice Box", "⏸️ Blocked", "🟣 Considering", "🔴 To Do", "🟠 To Book", "🟡 Scheduled", "🔵 Doing", "🟢 Done", "↗️ Next Year", "❌ Cancelled" |
| Category | select | "💼 Work", "🌱 Personal" |
| PERSONAL Category | select | "🎸 Hobbies", "🍻 Interpersonal", "🏠 Home", "💪 Physical Health", "❤️ Mental Health", "🍗 Cooking", "🌱 Admin" |
| WORK Category | select | "🎨 Design", "🖥️ Coding", "💡 Exploration", "⚠️ Critique", "🔎 QA", "🤝 Hiring & Team", "💼 Admin" |
| Clarifying Statement | text | What done looks like |
| Outcome | text | The "so that" — read with Clarifying Statement via the `Goal Statement` formula |
| Goal Date | date | |
| Achieved Date | date | |
| Calendar Created | checkbox | |
| 🏔️ 2026 High Level Goals | relation | → High Level Goals database (single) |
| 🔗 2026 Goal Themes | relation | → Goal Themes database |
| 🔁 2026 Habits | relation | → Habits database |
| ⏰ 2026 Weeks | relation | → Weeks database |
| 🔨 2026 Projects | relation | → Projects database |
| 🎟️ 2026 Events | relation | → Events database |
| ✈️ 2026 Trips | relation | → Trips database |
| 👤 Be, Do, Have | relation | → Life Purpose database |

## 2026 Rocks

| Property | Type | Values |
|----------|------|--------|
| Rock | title | |
| Status | status | "⏸️ Blocked", "🔴 To Do", "🔵 Doing", "🟢 Done" |
| Retro | status | "❓ Not Ranked", "⚫️ N/A", "🔴 Failed", "🔵 Progress", "🟢 Achieved" |
| Category | select | "💼 Work", "🌱 Personal", "🍻 Interpersonal", "🏠 Home", "💪 Physical Health", "❤️ Mental Health", "🫥 N/A" |
| Work Category | select | "🧪 Research", "💡 Sketch", "🎨 Design", "🖥️ Coding", "⚠️ Crit", "🔎 QA", "📝 Admin", "🍸 Social", "🏝️ OOO", "🫥 N/A" |
| Description | text | |
| Date | date | |
| ⏰ 2026 Weeks | relation | → Weeks database (single) |
| ✅ 2026 Tasks | relation | → Tasks database |

## 2026 Tasks

| Property | Type | Values |
|----------|------|--------|
| Task | title | |
| Status | status | "🧊 Ice Box", "🔴 To Do", "🟡 Scheduled", "🔵 Doing", "🟢 Done" |
| Category | select | "💼 Work", "🌱 Personal", "🍻 Interpersonal", "🏠 Home", "💪 Physical Health", "❤️ Mental Health" |
| Work Category | select | "🧪 Research", "💡 Sketch", "🎨 Design", "🖥️ Coding", "⚠️ Crit", "🔎 QA", "📝 Admin", "🍸 Social", "🏝️ OOO" |
| Personal Category | select | "💻 Coding", "📝 Admin" |
| Due Date | date | **Use this to filter tasks by date** |
| Notes | text | |
| Priority | text | |
| 🪨 2026 Rocks | relation | → Rocks database |
| 💎 2026 Projects | relation | → Projects database |
| 🏆 2026 Goals | rollup | Read-only — derives from 💎 2026 Projects → the project's 🏆 Goal. Never write it; set the project relation instead. (Was a direct relation until 2026-07-11.) |

**Important:** To find tasks for a specific day, filter by the "Due Date" property, NOT by rock or week relations.

## 2026 Events

| Property | Type | Values |
|----------|------|--------|
| Event Name | title | |
| Status | status | "🧊 Ice Box", "⏸️ Blocked", "🟣 Considering", "🔴 To Do", "🟠 To Book", "🟡 Scheduled", "🔵 Doing", "🟢 Done", "↗️ Next Year", "🛑 Won't Do" |
| Category | select | "🌱 Personal", "🍻 Interpersonal", "❤️ Mental Health", "🏠 Home", "💪 Physical Health", "💼 Work" |
| Subcategory | select | "🎪 Work Conferences & Events", "🍸 Work Social", "🏝️ Work OOO", "🚀 Work Milestone", "😎 Work Remote", "💜 Family Event", "🍻 Friend Event", "🗽 Friends & Fam vist NYC", "💒 Wedding", "❤️ Relationship", "🎄 Family Holidays", "🏠 Home Updates", "🕶️ Shopping & Styling", "🎸 Concerts", "🎭 Comedy", "🏛️ Museums & Tours", "🏈 Sports Event", "🗳️ Volunteer & Vote", "🏝️ Vacation", "🧗 Adventures", "🏃 Race", "🩺 Medical", "🤒 Sick", "😔 Wasted Day" |
| Date | date | **Use this to filter events by date** |
| Notes | text | |
| Calendar Event ID | text | |
| Calendar Created | checkbox | |
| ⏰ 2026 Weeks | relation | → Weeks database |
| ✈️ 2026 Trips | relation | → Trips database |
| 🏆 2026 Goals | relation | → Goals database |

## 2026 Trips

| Property | Type | Values |
|----------|------|--------|
| Trip Name | title | |
| Status | status | "🧊 Ice Box", "⏸️ Blocked", "🟣 Considering", "🔴 To Do", "🟠 To Book", "🟡 Scheduled", "🔵 Doing", "🟢 Done", "↗️ Next Year", "🛑 Won't Do" |
| Category | select | "💼 Work", "🌱 Personal", "🍻 Interpersonal" |
| Subcategory | multi_select | "💼 Work Trip", "🌱 Personal Trip", "💜 Family Trip", "🎄 Family Holidays", "🍻 Friends Trip", "💒 Wedding", "🧗‍♀️ Adventure" |
| Date | date | **Use this to filter trips by date** |
| Notes | text | |
| Calendar Event ID | text | |
| Calendar Created | checkbox | |
| ⏰ 2026 Weeks | relation | → Weeks database |
| 🎟️ 2026 Events | relation | → Events database |
| 🏆 2026 Goals | relation | → Goals database |
| 🌆 Cities | relation | → Cities database |

**Note:** Trips use multi_select for Subcategory (a trip can be both Work Trip AND Personal Trip). Events use single select.

## 2026 Weeks

| Property | Type | Values |
|----------|------|--------|
| Week | title | e.g. "Week 10" |

## 2026 Months

| Property | Type | Values |
|----------|------|--------|
| Month | title | e.g. "March" |
| Year | relation | → Years database |
| Weeks | relation | → Weeks database |

## 2026 Relationships

| Property | Type | Values |
|----------|------|--------|
| Name | title | |
| Nicknames | text | |
| Weeks | relation | → Weeks database |

## 2026 Personal Plan Months

| Property | Type | Values |
|----------|------|--------|
| Month Plan | title | e.g. "03. Mar Personal Plan" |
| Status | status | "Not started", "In progress", "Done" |
| Personal Plan | text | |
| Interpersonal Plan | text | |
| Home Plan | text | |
| Physical Health Plan | text | |
| Mental Health Plan | text | |
| 🗓️ 2026 Months | relation | → Months database |

**Formulas (read-only):** Personal Rocks, Work Trips & Events

## 2026 Work Plan Months

| Property | Type | Values |
|----------|------|--------|
| Month Plan | title | e.g. "03. Mar Work Plan" |
| Status | status | "Not started", "In progress", "Done" |
| Work Plan | text | |
| 🗓️ 2026 Months | relation | → Months database |

**Formulas (read-only):** Work Rocks, Work Trips & Events

## Key Querying Notes

1. **Filter by date properties, not relations.** To find "tasks due today," filter Tasks by "Due Date", not by week or rock relations.
2. **Date property format:** Dates use expanded format: `date:Date:start`, `date:Date:end`, `date:Date:is_datetime`.
3. **Relations use emoji prefixes.** The relation property names include emojis: "⏰ 2026 Weeks", "✅ 2026 Tasks", "🪨 2026 Rocks", etc.
4. **Status values include emojis.** Always use the full status string including the emoji: "🔴 To Do", not "To Do".
5. **Trips use multi_select for Subcategory.** Events use single select. Don't confuse them.
6. **Rocks have two status properties.** "Status" tracks progress (To Do → Done). "Retro" tracks retrospective assessment (Not Ranked → Achieved/Failed/Progress).
