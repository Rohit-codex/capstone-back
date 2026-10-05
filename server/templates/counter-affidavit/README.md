# Counter affidavit templates

Add new court layouts here without changing application code.

## Standard counter sections (generated content)

1. **Formal heading (cause title)** — court, jurisdiction, case number, parties (from Smart Scan + petition extraction); document title subheading from `documentTitle`.
2. **Details of the deponent** — `deponentDetails` in LLM JSON.
3. **Defence** (optional, user-filled in Counter Studio) — `defenceSection[]` after deponent, before objections.
4. **Preliminary objections** — `preliminaryObjections[]`.
5. **Para-wise reply** — `counterDraft[]` with `petitionParaNo`, `stance` (admit/deny/partly), `counterArgument`, `supportingLaw`.
6. **Statement of additional facts** — `statementOfAdditionalFacts[]`.
7. **Prayer** — `prayer`.
8. **Verification** — `verification` (+ signature block from template labels).

## Structure

```
templates/counter-affidavit/
  registry.json              # lists designs + defaultDesignId
  india-formal-affidavit/
    design.json
  writ-petition-counter/
    design.json
```

## Add a design

1. Copy an existing folder (e.g. `india-formal-affidavit`) to `my-new-design/`.
2. Edit `my-new-design/design.json` (`id`, `labels`, `layout`, `css`, `footer`).
3. Register in `registry.json`:

```json
{
  "id": "my-new-design",
  "label": "My court layout",
  "description": "Short note for the UI",
  "path": "my-new-design"
}
```

4. Restart the backend (designs are cached in memory).

Legacy path `counter-affidavit-designs/` is still supported if this folder is missing.
