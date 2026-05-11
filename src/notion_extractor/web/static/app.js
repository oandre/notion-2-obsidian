const $ = (sel) => document.querySelector(sel);
const ICON = { page: "📄", database: "🗃️" };

async function loadRoots() {
  const response = await fetch("/api/roots");
  if (!response.ok) {
    $("#loading").textContent = "Erro ao carregar: " + response.status;
    return;
  }
  const roots = await response.json();
  const ul = $("#root-list");
  ul.innerHTML = "";
  for (const r of roots) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = JSON.stringify({ id: r.id, kind: r.kind, title: r.title });
    cb.addEventListener("change", updateButtonState);
    const label = document.createElement("label");
    label.append(cb, ` ${ICON[r.kind] ?? "•"} ${r.title}`);
    li.append(label);
    ul.append(li);
  }
  $("#loading").hidden = true;
  ul.hidden = false;
}

function updateButtonState() {
  const any = document.querySelectorAll("#root-list input:checked").length > 0;
  $("#extract-btn").disabled = !any;
}

function gatherSelection() {
  return Array.from(document.querySelectorAll("#root-list input:checked"))
    .map((cb) => JSON.parse(cb.value));
}

async function startExtraction() {
  const selection = gatherSelection();
  $("#selection-view").hidden = true;
  $("#progress-view").hidden = false;
  $("#status").textContent = "Iniciando…";

  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection }),
  });
  const { job_id } = await response.json();

  const source = new EventSource(`/api/events?job=${job_id}`);
  let total = 0;
  let done = 0;

  source.addEventListener("discovery_started", () => {
    appendLog("Descoberta iniciada");
  });
  source.addEventListener("discovery_done", (e) => {
    const data = JSON.parse(e.data);
    total = data.total;
    $("#bar").max = total;
    $("#status").textContent = `Descobertos ${total} nós. Extraindo…`;
    appendLog(`Descobertos ${total} nós`);
  });
  source.addEventListener("node_done", (e) => {
    done++;
    $("#bar").value = done;
    const data = JSON.parse(e.data);
    appendLog(`✓ ${data.id}`, "done");
  });
  source.addEventListener("node_failed", (e) => {
    const data = JSON.parse(e.data);
    appendLog(`✗ ${data.id}: ${data.reason}`, "failed");
  });
  source.addEventListener("extraction_done", (e) => {
    const data = JSON.parse(e.data);
    $("#status").textContent =
      `Concluído: ${data.pages} páginas, ${data.items} itens, ${data.attachments} anexos.`;
    source.close();
  });
}

function appendLog(text, cls = "") {
  const div = document.createElement("div");
  div.className = "log-line " + cls;
  div.textContent = text;
  $("#log").append(div);
  $("#log").scrollTop = $("#log").scrollHeight;
}

$("#extract-btn").addEventListener("click", startExtraction);
loadRoots();
