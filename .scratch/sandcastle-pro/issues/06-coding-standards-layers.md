# 06: Coding Standards layers and Must Rules

Status: done
Blocked by: 02

Spec: `.scratch/sandcastle-pro/spec.md`

**What to build:** The Review Session checks changes against three layers of Coding Standards:
- **Preset:** universal rules shipped with the package.
- **Personal:** a single file in the user's config directory (`~/.config/sandcastle-pro/CODING_STANDARDS.md`).
- **Project:** the project's `.sandcastle/CODING_STANDARDS.md`.

When rules conflict, Project wins over Personal, and Personal wins over Preset. Rules under a `## Must` heading in any layer are Must Rules: breaking one is a Critical Finding. Breaking any other rule is a Non-critical Finding. Coding Standards are loaded only into the Review Session, never into the Implementer.

- [x] The Review Session prompt includes all three layers, clearly ordered by precedence
- [x] A missing Personal or Project layer is skipped silently
- [x] Must Rules are identified and presented as Critical
- [x] The Implementer prompt includes no Coding Standards
- [x] Tests point `HOME` at a temp directory for the Personal layer
