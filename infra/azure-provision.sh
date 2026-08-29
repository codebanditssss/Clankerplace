#!/usr/bin/env bash
# Provision the FuelBorn prototype Azure VM, NSG, public IP, and data disk.
# Idempotent-ish: uses `az group exists` to skip if the RG already exists.
# Requires: az CLI logged in, ssh key at $SSH_KEY.
set -euo pipefail

RG="${RG:-pods-ml-prototype}"
LOCATION="${LOCATION:-eastus}"
VM="${VM:-pods-ml-prototype}"
DNS_LABEL="${DNS_LABEL:-pods-ml-prototype}"
ADMIN_USER="${ADMIN_USER:-podsadmin}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"
VM_SIZE="${VM_SIZE:-Standard_D4s_v5}"
OS_DISK_GB="${OS_DISK_GB:-64}"
DATA_DISK_GB="${DATA_DISK_GB:-128}"

[[ -f "$SSH_KEY" ]] || { echo "SSH public key not found: $SSH_KEY" >&2; exit 1; }

echo "==> Creating resource group $RG in $LOCATION"
az group create -n "$RG" -l "$LOCATION" -o table

echo "==> Creating NSG ${VM}-nsg"
az network nsg create -g "$RG" -n "${VM}-nsg" -o table

echo "==> Adding NSG inbound rules"
az network nsg rule create -g "$RG" --nsg-name "${VM}-nsg" \
  --name allow-ssh --priority 1000 \
  --destination-port-ranges 22 --protocol Tcp --access Allow -o none

az network nsg rule create -g "$RG" --nsg-name "${VM}-nsg" \
  --name allow-http --priority 1010 \
  --destination-port-ranges 80 443 --protocol Tcp --access Allow -o none

az network nsg rule create -g "$RG" --nsg-name "${VM}-nsg" \
  --name allow-wings --priority 1020 \
  --destination-port-ranges 8080 2022 --protocol Tcp --access Allow -o none

az network nsg rule create -g "$RG" --nsg-name "${VM}-nsg" \
  --name allow-pods-tcp --priority 1030 \
  --destination-port-ranges 1024-65535 --protocol Tcp --access Allow -o none

az network nsg rule create -g "$RG" --nsg-name "${VM}-nsg" \
  --name allow-pods-udp --priority 1040 \
  --destination-port-ranges 1024-65535 --protocol Udp --access Allow -o none

echo "==> Creating VM $VM ($VM_SIZE, Ubuntu 22.04)"
az vm create -g "$RG" -n "$VM" \
  --image Ubuntu2204 --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --ssh-key-values "@$SSH_KEY" \
  --public-ip-address-dns-name "$DNS_LABEL" \
  --public-ip-sku Standard \
  --os-disk-size-gb "$OS_DISK_GB" --storage-sku Premium_LRS \
  --nsg "${VM}-nsg" \
  --accelerated-networking true \
  -o table

echo "==> Attaching $DATA_DISK_GB GB Premium data disk"
az vm disk attach -g "$RG" --vm-name "$VM" \
  --name "${VM}-data" --new --size-gb "$DATA_DISK_GB" --sku Premium_LRS \
  -o none

echo "==> VM connection info:"
az vm show -g "$RG" -n "$VM" -d \
  --query "{fqdn:fqdns, ip:publicIps, user:osProfile.adminUsername}" -o table

echo
echo "Next: ssh ${ADMIN_USER}@$(az vm show -g "$RG" -n "$VM" -d --query fqdns -o tsv)"
