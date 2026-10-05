# Sync gratis fuori da GitHub Actions (Oracle Always Free + runner)

Perche': con il repo **privato** GitHub Actions da' solo 2.000 minuti/mese
gratis (piano Free). I sync ne consumano molti di piu'. I runner
*self-hosted* (una macchina tua) non consumano minuti. Questa guida mette il
runner su una VM Oracle gratuita e fa partire il sync delle carte tracciate
ogni 15 minuti senza dipendere dai cron di GitHub (che saltano gli avvii).

Come funziona: un cron sulla VM chiama l'API di GitHub (`workflow_dispatch`);
il workflow gira sul runner della stessa VM. I segreti (CardTrader, Neon)
restano nei Secrets di GitHub, non sulla VM. Sulla VM c'e' solo un token
limitato a "lancia workflow".

## ORDINE IMPORTANTE
1. Prima rendi il repo **privato** (passo 1). Un runner self-hosted su un
   repo pubblico e' pericoloso: chiunque potrebbe far girare codice sulla VM
   con una pull request.
2. Solo dopo: crea VM, installa il runner, imposta la variabile `CT_RUNNER`.

Finche' la variabile `CT_RUNNER` non e' impostata i workflow usano
`ubuntu-latest` come sempre: nulla si rompe.

## 1. Rendi privato il repo
GitHub -> repo ct-tracker -> Settings -> in fondo "Danger Zone" ->
"Change repository visibility" -> Private.
Poi controlla Vercel: il deploy dal repo privato deve continuare a funzionare
(Vercel -> progetto -> Settings -> Git: se chiede accesso al repo, concedilo).

## 2. Crea l'account Oracle e la VM
1. https://www.oracle.com/cloud/free/ -> "Start for free". Serve una carta
   solo per verifica; restando nelle risorse "Always Free" non si paga.
   Scegli come "home region" una regione vicina (non si cambia dopo).
2. Menu -> Compute -> Instances -> Create instance.
   - Image: Ubuntu 24.04.
   - Shape: Ampere `VM.Standard.A1.Flex`, 1 OCPU, 6 GB (basta).
     Se compare "Out of host capacity": riprova piu' tardi o cambia
     Availability Domain. In alternativa `VM.Standard.E2.1.Micro` (1 GB,
     serve uno swap, vedi passo 3).
   - SSH keys: "Generate a key pair" e **scarica la chiave privata**
     (serve per entrare). Non condividerla con nessuno.
   - Networking: lascia la regola predefinita (solo porta 22 SSH in
     ingresso). Non aprire altre porte: il runner si collega *in uscita*
     verso GitHub, non serve nulla in entrata.
3. Annota l'IP pubblico. Connessione:
   `ssh -i chiave.key ubuntu@IP_PUBBLICO`

## 3. Prepara la VM (incolla in ordine)
```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install curl git unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # rispondi Yes: aggiornamenti di sicurezza automatici
# Solo se hai scelto la micro da 1 GB: aggiungi 2 GB di swap
# sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

## 4. Installa il runner
1. GitHub -> repo -> Settings -> Actions -> Runners -> **New self-hosted
   runner** -> Linux, architettura **ARM64** (o x64 se micro).
2. La pagina mostra i comandi "Download" e "Configure" con un token
   temporaneo gia' compilato: copiali e incollali sulla VM, in ordine.
   Alla domanda sulle label premi Invio (va bene `self-hosted`).
3. Installalo come servizio, cosi' riparte da solo dopo un riavvio:
```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status    # deve dire "active (running)"
```
Il runner deve risultare "Idle" (verde) in Settings -> Actions -> Runners.

## 5. Token per far partire il sync ogni 15 minuti
1. GitHub -> tua foto -> Settings -> Developer settings -> Personal access
   tokens -> **Fine-grained tokens** -> Generate new token.
   - Repository access: *Only select repositories* -> ct-tracker.
   - Permissions -> Repository -> **Actions: Read and write**. Nient'altro.
   - Scadenza: 1 anno (segnati la data per rinnovarlo).
2. Sulla VM:
```bash
sudo mkdir -p /etc/ct-tracker
sudo sh -c 'umask 077; read -r -p "Incolla il token: " T; echo "GH_DISPATCH_TOKEN=$T" > /etc/ct-tracker/dispatch.env'
sudo chown ubuntu:ubuntu /etc/ct-tracker/dispatch.env && sudo chmod 600 /etc/ct-tracker/dispatch.env
```
3. Scarica lo script e prova una volta a mano:
```bash
sudo curl -fsSL -o /usr/local/bin/ct-dispatch-sync \
  https://raw.githubusercontent.com/RevanExile-dev/ct-tracker/main/scripts/oracle/dispatch_sync.sh
```
   (repo privato: il raw non e' pubblico. In quel caso copia il file con
   `scp -i chiave.key scripts/oracle/dispatch_sync.sh ubuntu@IP:/tmp/` e poi
   `sudo install -m 755 /tmp/dispatch_sync.sh /usr/local/bin/ct-dispatch-sync`.)
```bash
sudo chmod 755 /usr/local/bin/ct-dispatch-sync
ct-dispatch-sync    # deve stampare "dispatch ok"
```
4. Cron ogni 15 minuti (a minuti "dispari" per evitare le ore di punta):
```bash
( crontab -l 2>/dev/null; echo '7,22,37,52 * * * * /usr/local/bin/ct-dispatch-sync >> /home/ubuntu/ct-dispatch.log 2>&1' ) | crontab -
```

## 6. Accendi il runner nei workflow
GitHub -> repo -> Settings -> Secrets and variables -> Actions -> tab
**Variables** -> New repository variable: nome `CT_RUNNER`, valore
`self-hosted`. Da quel momento i sync girano sulla VM.
Per tornare indietro in un attimo: elimina la variabile (o mettila a
`ubuntu-latest`).

## Cose da sapere
- **Rischio principale:** Oracle puo' "recuperare" le VM Always Free se per 7
  giorni CPU (95 percentile), rete e (solo Arm) memoria stanno tutte sotto il
  20%. Un runner quasi sempre fermo rientra in quel caso. Se la VM sparisce
  i sync si fermano: elimina `CT_RUNNER` per tornare su GitHub (consuma i
  minuti) e ricrea la VM. L'Oracle non dice se avvisa prima.
- Controlla che i sync arrivino: Actions -> "Sync prezzi CardTrader (carte
  tracciate)" deve avere un run ogni ~15 minuti.
- Il cron di GitHub (ogni 30 min) resta come rete di sicurezza: se parte
  insieme a un avvio dalla VM, la coda e' unica (stesso `concurrency`), nessun
  doppio scrittore sul database.
- CI (build, Playwright) e review Gemini/Groq restano su GitHub: pochi minuti.
- Se in passato e' finita una chiave nel codice o nei log, cambiala: passare
  a privato non cancella quanto gia' visto.
