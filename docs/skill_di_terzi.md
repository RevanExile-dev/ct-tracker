# Skill di terzi fissate nel repo

Data: 2026-10-09. Autorizzazione di Cri: "applica tutto ciò che ritieni utile e gratis".
Contesto e analisi completa: thread "Skill e strumenti utili" (report
`ct-tracker/skill-e-strumenti-2026-10-09/report-skill-e-strumenti.md` nei file di progetto).

## Cosa c'è in `.claude/skills/`

Le skill sono **copie fissate** (nessun `npx`, nessun download a ogni uso): il testo che
gira è questo, riletto e versionato qui.

| Skill | Fonte e commit | Serve a |
|---|---|---|
| `frontend-design` | anthropics/skills @ 683bc88 | Linee guida per un'estetica con identità (solo testo) |
| `neon-postgres-egress-optimizer` | neondatabase/agent-skills @ bfd013c | Trovare query che scaricano troppi dati da Neon |
| `neon-postgres-branches` | neondatabase/agent-skills @ bfd013c | Scegliere il tipo di branch per provare migrazioni |
| `web-quality-audit`, `performance`, `core-web-vitals`, `accessibility`, `seo`, `best-practices` | addyosmani/web-quality-skills @ afa8da9 | Audit misurato (Lighthouse, tracce, WCAG 2.2) |

Regola applicata: copiata solo una skill con licenza permissiva (MIT/Apache-2.0) e file di licenza presente accanto ai file; il resto è fuori.
Licenze e fonti: `.claude/skills/THIRD_PARTY_NOTICES.md`. Le licenze originali restano
valide per quei file (la licenza del repo "tutti i diritti riservati" non le sostituisce).

## Come sono state controllate

- Letti per intero: i `SKILL.md` di tutte le skill copiate, lo script `web-quality-audit/scripts/analyze.sh` (sola lettura, nessuna scrittura).
- Scansionati con ricerca automatica, **non letti riga per riga**: i file `references/`.
- Su tutti i file copiati: 0 caratteri nascosti o invisibili; nessun comando eseguito al caricamento (`!`), nessun hook, nessun `allowed-tools`; nessuna frase che chiede di ignorare istruzioni, nascondere cose all'utente o inviare dati altrove.
- Modifiche locali (solo queste): in `neon-postgres-egress-optimizer` e `neon-postgres-branches`, un blocco "ct-tracker note" dopo l'intestazione: vieta i comandi `neon skills`/`npm i @neon/config` e il download della skill madre, ricorda la conferma prima di DELETE/DROP/TRUNCATE e di cancellare branch. 
- Aggiornamenti: nessun aggiornamento automatico. Per aggiornare si ricopia dalla fonte, si rilegge il diff e si aggiorna questa tabella.

## Valutate e NON copiate

- Trail of Bits `agentic-actions-auditor` / `differential-review`: licenza CC-BY-SA 4.0 (condivisione allo stesso modo), incompatibile con "tutti i diritti riservati" del repo; hanno anche `allowed-tools: Bash`. Il metodo è stato applicato a mano ai workflow (sotto).
- Impeccable, ui-ux-pro-max: letto solo il README; Impeccable scarica un programma e installa un hook su ogni modifica UI. Da riconsiderare solo dopo averne letto il codice.
- `vercel-react-best-practices` (Vercel): tolta prima del merge, il repo di origine non ha un file di licenza né un avviso di copyright (solo un campo "MIT" nell'intestazione della skill): termini non abbastanza chiari. Da riammettere se Vercel aggiunge la licenza.
- `vercel-optimize` (richiede Observability Plus a pagamento), `web-design-guidelines` (scarica regole da un altro repo a ogni uso), Context7, shadcn (Tailwind 4), Playwright MCP, Blender MCP: non servono o non sono gratuiti/sicuri ora.

## Chrome DevTools MCP: non attivo

Non ho aggiunto `.mcp.json` (avvierebbe in ogni sessione un programma scaricato). Per provarlo a mano,
sempre con versione fissata: `npx chrome-devtools-mcp@1.10.1` (Google, Apache-2.0; controllare le opzioni sul README prima).
Senza MCP, Lighthouse da riga di comando funziona già qui (vedi sotto).

## Prima misura (Lighthouse 13.5.0, mobile simulato, home di produzione, 2026-10-09, una sola esecuzione)

Prestazioni 74, Accessibilità 100, Best practice 77, SEO 100. LCP 2,8 s, CLS 0,019, **TBT 990 ms**, TTI 4,5 s.
Il collo di bottiglia è il lavoro di JavaScript sul thread principale (9,4 s in totale, 4,1 s sulla pagina stessa, due blocchi di codice da 2,3 s e 1,7 s). Cache dei file statici e peso immagini (~3 MB risparmiabili stimati) sono i due altri punti deboli.
Una sola misura simulata è un'indicazione, non una prova: va ripetuta e confermata su un telefono vero prima di agire.

## Controllo dei workflow GitHub (metodo Trail of Bits, a mano)

Nessun workflow usa action di agenti AI (Claude Code Action, Gemini CLI, Codex) né `pull_request_target`/`issue_comment`.
`ai_review.yml` passa gli input tramite variabili d'ambiente (corretto). Rilievo minore: `probe_api.yml`, `inspect_blueprint.yml`
mettono `${{ inputs.* }}` direttamente nel comando shell; solo chi può lanciare il workflow a mano (chi ha già accesso in scrittura) li controlla, quindi rischio basso. Non corretto in questa PR.
