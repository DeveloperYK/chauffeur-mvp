# Chauffeur Dispatch — MVP Design Package

Design package for the chauffeur dispatch platform MVP, for partner review before client sign-off.

## What's in here

| File | Audience | Purpose |
|---|---|---|
| [`EXECUTIVE-SUMMARY.md`](./EXECUTIVE-SUMMARY.md) | Partner + client (non-technical) | One-pager: problem, solution, scope, transition, timeline. Start here when sharing. |
| [`DESIGN.md`](./DESIGN.md) | Partner + client (technical-curious) | Full design. Flows, architecture, state machine, risks, scale considerations. |
| [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md) | Partner → client | Numbered questions to resolve with the client before build kicks off. |
| `diagrams/*.md` | Anyone | Each diagram in its own file, for viewing in Obsidian or any Mermaid-aware viewer. |

## How to share with the client

1. Send **`EXECUTIVE-SUMMARY.md`** first — it's the cover sheet.
2. Walk through **`DESIGN.md`** in a working session. The diagrams render natively in Obsidian, GitHub, Notion, and most modern markdown viewers.
3. Use **`OPEN-QUESTIONS.md`** as the agenda for the follow-up call.

## Viewing the diagrams

- **In Obsidian:** Mermaid renders automatically inside any `.md` file. Each diagram is a standalone file under `diagrams/`.
- **On GitHub:** same, renders natively.
- **In VS Code:** install the "Markdown Preview Mermaid Support" extension, then Cmd+Shift+V on any markdown file.

## MVP at a glance

- **What changes:** operator dashboard replaces the spreadsheet; driver hand-off becomes a signed WhatsApp link with accept/decline + completion form.
- **What stays the same (client side):** PA still phones the operator. Executive still gets the same two SMS messages (now sent automatically).
- **Backup:** every change mirrors to a Google Sheet matching the existing layout, so the business can fall back at any time.
- **Out of MVP:** PA portal, native driver app, GPS, auto-dispatch, backfill subcontractor workflow, billing.

## Status

- **Design phase:** complete, pending partner review and client Q&A.
- **Build phase:** not started. Begins only after partner sign-off and resolution of open questions.

## Next steps

1. Partner reviews `EXECUTIVE-SUMMARY.md` and `DESIGN.md`.
2. Partner takes `OPEN-QUESTIONS.md` to the client.
3. Once answers come back, we produce the build-side artefacts: data model (ERD), REST API contract, dashboard UI mockups, build estimate.
4. Build.
