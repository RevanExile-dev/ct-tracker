#!/usr/bin/env bash
# Crea la VM Oracle "ct-runner" (Always Free, Ampere A1) riprovando finche'
# Oracle ha posto ("Out of host capacity"). Da incollare in OCI Cloud Shell,
# dove la CLI `oci` e' gia' autenticata: nessuna credenziale da inserire.
#
# - Solo Always Free: shape VM.Standard.A1.Flex, 1 OCPU, 6/4/2 GB, boot 50 GB.
#   Nessuna shape a pagamento.
# - Sicuro da rilanciare: se esiste gia' un'istanza "ct-runner" (non
#   terminata) non ne crea un'altra, stampa solo come collegarsi.
# - Rete: riusa (o crea se mancano) ct-vcn, internet gateway, route e subnet
#   pubblica ct-subnet. La regola predefinita lascia entrare solo SSH (22).
set -uo pipefail

NAME="ct-runner"
SHAPE="VM.Standard.A1.Flex"          # Always Free. NON cambiare con shape a pagamento.
OCPUS=1
MEMORIES=(6 4 2)                     # GB, provati in quest'ordine a ogni giro
BOOT_GB=50
SLEEP_S=150
KEY="$HOME/.ssh/ct_runner"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
die() { echo "ERRORE: $*" >&2; exit 1; }

command -v oci >/dev/null || die "comando 'oci' non trovato: apri Cloud Shell dal sito Oracle (icona >_ in alto a destra)."

# Compartment = root (tenancy). Cloud Shell espone OCI_TENANCY.
C="${OCI_TENANCY:-$(grep -m1 '^tenancy=' "$HOME/.oci/config" 2>/dev/null | cut -d= -f2)}"
[ -n "$C" ] || die "non trovo il tenancy. Controlla di essere in Cloud Shell."

show_instance() {  # $1 = instance id
  local ip
  ip=$(oci compute instance list-vnics --instance-id "$1" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
  echo
  echo "=============================================="
  echo " VM PRONTA: $NAME"
  echo " IP pubblico: ${ip:-<non ancora assegnato, rilancia lo script tra un minuto>}"
  echo " Collegati da Cloud Shell:  ssh -i $KEY ubuntu@${ip:-IP}"
  echo " Per la chiave sul tuo PC: vedi la guida (scarica $KEY dal menu di Cloud Shell)."
  echo "=============================================="
}

existing_instance() {
  oci compute instance list -c "$C" --display-name "$NAME" --all \
    --query 'data[?"lifecycle-state"!=`TERMINATED` && "lifecycle-state"!=`TERMINATING`] | [0].id' \
    --raw-output 2>/dev/null
}

# 0) Gia' creata? Allora basta stampare i dati.
EX=$(existing_instance)
if [ -n "$EX" ] && [ "$EX" != "null" ]; then
  log "L'istanza $NAME esiste gia'."
  show_instance "$EX"
  exit 0
fi

# 1) Chiave SSH (si crea una volta sola, resta nella home di Cloud Shell)
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "ct-runner" -f "$KEY" >/dev/null || die "ssh-keygen fallito"
  log "Chiave SSH creata: $KEY (privata) e $KEY.pub"
fi

# 2) Availability domain e immagine Ubuntu 24.04 aarch64 piu' recente
mapfile -t ADS < <(oci iam availability-domain list -c "$C" --query 'data[].name' --raw-output 2>/dev/null | tr -d '[]," ' | grep -v '^$')
[ "${#ADS[@]}" -gt 0 ] || die "nessun availability domain trovato"
IMG=$(oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --limit 1 --query 'data[0].id' --raw-output 2>/dev/null)
[ -n "$IMG" ] && [ "$IMG" != "null" ] || die "immagine Ubuntu 24.04 per $SHAPE non trovata"
log "Immagine: $IMG"

# 3) Rete (riusa se esiste)
find_id() { oci "$@" --query 'data[0].id' --raw-output 2>/dev/null | grep -v '^null$'; }

VCN=$(find_id network vcn list -c "$C" --display-name ct-vcn --lifecycle-state AVAILABLE)
if [ -z "$VCN" ]; then
  log "Creo ct-vcn"
  VCN=$(oci network vcn create -c "$C" --display-name ct-vcn --cidr-block 10.0.0.0/24 \
        --wait-for-state AVAILABLE --query 'data.id' --raw-output) || die "creazione VCN fallita"
fi
# Riusa qualunque internet gateway gia' presente nella VCN (anche creato dalla
# console con un altro nome): una VCN ne ammette uno solo.
IGW=$(find_id network internet-gateway list -c "$C" --vcn-id "$VCN" --lifecycle-state AVAILABLE)
if [ -z "$IGW" ]; then
  log "Creo internet gateway"
  IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --display-name ct-igw --is-enabled true \
        --wait-for-state AVAILABLE --query 'data.id' --raw-output) || die "creazione internet gateway fallita"
fi
RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
NRULES=$(oci network route-table get --rt-id "$RT" --query 'length(data."route-rules")' --raw-output 2>/dev/null || echo 0)
if [ "${NRULES:-0}" = "0" ]; then
  log "Aggiungo la route verso internet"
  oci network route-table update --rt-id "$RT" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null \
    || die "aggiornamento route table fallito"
fi
# Subnet: ct-subnet se c'e', altrimenti la prima subnet disponibile della VCN
# (es. quella creata dalla procedura guidata della console).
SUBNET=$(find_id network subnet list -c "$C" --vcn-id "$VCN" --display-name ct-subnet --lifecycle-state AVAILABLE)
[ -n "$SUBNET" ] || SUBNET=$(find_id network subnet list -c "$C" --vcn-id "$VCN" --lifecycle-state AVAILABLE)
if [ -z "$SUBNET" ]; then
  log "Creo la subnet pubblica ct-subnet"
  SUBNET=$(oci network subnet create -c "$C" --vcn-id "$VCN" --display-name ct-subnet --cidr-block 10.0.0.0/24 \
        --prohibit-public-ip-on-vnic false --wait-for-state AVAILABLE --query 'data.id' --raw-output) \
        || die "creazione subnet fallita"
fi

# 4) Loop di tentativi
log "Provo a creare $NAME ($SHAPE, ${OCPUS} OCPU) ogni ~$((SLEEP_S/60)) minuti. Lascia questa scheda aperta."
n=0
while true; do
  n=$((n+1))
  EX=$(existing_instance)
  if [ -n "$EX" ] && [ "$EX" != "null" ]; then
    log "Istanza trovata."; show_instance "$EX"; exit 0
  fi
  for AD in "${ADS[@]}"; do
    for MEM in "${MEMORIES[@]}"; do
      log "Giro $n: provo $AD con ${MEM} GB..."
      OUT=$(oci compute instance launch \
        --availability-domain "$AD" --compartment-id "$C" \
        --shape "$SHAPE" --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM}" \
        --image-id "$IMG" --subnet-id "$SUBNET" --assign-public-ip true \
        --display-name "$NAME" --boot-volume-size-in-gbs "$BOOT_GB" \
        --ssh-authorized-keys-file "$KEY.pub" --query 'data.id' --raw-output 2>&1)
      RC=$?
      if [ $RC -eq 0 ] && [ -n "$OUT" ]; then
        log "CREATA! Attendo che parta..."
        oci compute instance get --instance-id "$OUT" --wait-for-state RUNNING >/dev/null 2>&1
        for _ in $(seq 1 30); do
          IP=$(oci compute instance list-vnics --instance-id "$OUT" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
          [ -n "$IP" ] && [ "$IP" != "null" ] && break
          sleep 10
        done
        show_instance "$OUT"
        exit 0
      fi
      if echo "$OUT" | grep -qiE 'capacity|TooManyRequests|InternalError|Timeout|timed out|Service Unavailable'; then
        log "Nessun posto per ora."
      else
        echo "$OUT" | tail -n 8 >&2
        die "errore diverso dalla mancanza di posto: mi fermo (copia il messaggio sopra e mandalo a Claude)."
      fi
      sleep 3
    done
  done
  # attesa con segnale di vita ogni 30 s, cosi' la scheda resta attiva
  for _ in $(seq 1 $((SLEEP_S/30))); do sleep 30; echo -n "."; done; echo
done
