# Project Coding Standards

<!--
Rules specific to this codebase. The Review Session checks every change against them, on top of
the Preset layer (shipped with sandcastle-pro) and your Personal layer
(~/.config/sandcastle-pro/CODING_STANDARDS.md). When rules conflict, this file wins.

Write one rule per list item. Delete the headings you don't need, or add your own.
Text inside HTML comments, like this one, is ignored.

Breaking a rule in this file is a Non-critical Finding: it is logged on the Issue for you to decide.
Only rules under the "## Must" heading at the bottom are fixed automatically.
-->

## Naming

<!--
- Database tables are plural snake_case, e.g. `order_items`.
- React components are PascalCase and live in a file of the same name.
-->

## Structure

<!--
- HTTP handlers only parse input and call a service; business logic lives in `src/services/`.
- No module in `src/domain/` imports from `src/infra/`.
-->

## Testing

<!--
- Every bug fix comes with a test that fails without the fix.
- Tests use the in-memory store, never the real database.
-->

## Must

<!--
Must Rules. Breaking one is a Critical Finding, which the Review Session fixes in the same pass,
so it costs tokens on every Issue that breaks it. Keep this list short: only rules worth that cost.

- Never log secrets, tokens or personal data.
- Every database migration is reversible.
-->
