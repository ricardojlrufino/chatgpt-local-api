#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nao encontrado. Instale o Node 22 ou mais novo em https://nodejs.org" >&2
  exit 1
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"; then
  echo "Node.js muito antigo ($(node --version)). E necessario o Node 22 ou mais novo." >&2
  exit 1
fi
exec node server.js "${@:-serve}"
