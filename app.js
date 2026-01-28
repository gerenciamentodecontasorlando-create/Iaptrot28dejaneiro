import { dbPut, dbGetAll, dbDelete, dbClear, newId, exportAll, importAll } from "./db.js";

const $ = (id) => document.getElementById(id);

const statusLine = $("statusLine");
const btnInstall = $("btnInstall");

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.style.display = "inline-flex";
});
btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.style.display = "none";
});

function pad(n){ return String(n).padStart(2,"0"); }
function ymd(d){
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
}
function humanDate(ymdStr){
  const [y,m,d] = ymdStr.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  return dt.toLocaleDateString("pt-BR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
}
function monthLabel(year, monthIndex){
  const dt = new Date(year, monthIndex, 1);
  return dt.toLocaleDateString("pt-BR", { month:"long", year:"numeric" });
}

function downloadFile(filename, content, type="application/json"){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function bootDemoIfEmpty(){
  const patients = await dbGetAll("patients");
  if (patients.length) return;

  // DEMO simples (você já pode editar/apagar pelo gerenciar)
  const p1 = { id:newId(), name:"Paciente Teste", phone:"(91) 99999-0000", dob:"", doc:"", createdAt: new Date().toISOString() };
  await dbPut("patients", p1);

  const today = ymd(new Date());
  const a1 = { id:newId(), date: today, time:"09:00", patientId:p1.id, status:"Confirmado", note:"Consulta teste", createdAt:new Date().toISOString() };
  await dbPut("appointments", a1);
}

/* ------------------ DADOS EM MEMÓRIA ------------------ */
let patients = [];
let appointments = [];

async function loadAll(){
  patients = await dbGetAll("patients");
  appointments = await dbGetAll("appointments");
  patients.sort((a,b) => (a.name||"").localeCompare(b.name||"", "pt-BR"));
  appointments.sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
}

/* ------------------ UI: SELECTS ------------------ */
function fillPatientSelects(){
  const selPatient = $("selPatient");
  const rxPatient = $("rxPatient");

  const opts = [`<option value="">— Selecione —</option>`]
    .concat(patients.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`));

  selPatient.innerHTML = opts.join("");
  rxPatient.innerHTML = opts.join("");

  // se não tiver paciente, dá um toque
  if (!patients.length){
    statusLine.textContent = "Crie pelo menos 1 paciente para agendar e gerar receita.";
  } else {
    statusLine.textContent = "Offline-first • Memória local (IndexedDB) • Imprimir receita";
  }
}

function escapeHtml(s=""){
  return s.replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* ------------------ CALENDÁRIO ------------------ */
const dowNames = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const dowRow = $("dowRow");
dowRow.innerHTML = dowNames.map(d => `<div class="dow">${d}</div>`).join("");

let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let selectedDate = ymd(new Date());

$("prevMonth").addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0){ viewMonth = 11; viewYear--; }
  renderCalendar();
});
$("nextMonth").addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11){ viewMonth = 0; viewYear++; }
  renderCalendar();
});
$("btnToday").addEventListener("click", () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  selectedDate = ymd(now);
  renderCalendar();
  renderDay();
});

function apptCountByDate(dateYmd){
  return appointments.filter(a => a.date === dateYmd).length;
}

function renderCalendar(){
  $("monthLabel").textContent = monthLabel(viewYear, viewMonth);

  const first = new Date(viewYear, viewMonth, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();

  // dias do mês anterior pra completar a grade
  const prevDays = new Date(viewYear, viewMonth, 0).getDate();

  const cells = [];
  for (let i=0; i<startDow; i++){
    const dayNum = prevDays - (startDow-1-i);
    const dt = new Date(viewYear, viewMonth-1, dayNum);
    const d = ymd(dt);
    cells.push({ label: dayNum, ymd:d, off:true });
  }
  for (let d=1; d<=daysInMonth; d++){
    const dt = new Date(viewYear, viewMonth, d);
    cells.push({ label:d, ymd: ymd(dt), off:false });
  }
  // completa até múltiplo de 7
  while (cells.length % 7 !== 0){
    const last = cells[cells.length-1];
    const dt = new Date(last.ymd);
    dt.setDate(dt.getDate()+1);
    cells.push({ label: dt.getDate(), ymd: ymd(dt), off:true });
  }

  $("calGrid").innerHTML = cells.map(c => {
    const cnt = apptCountByDate(c.ymd);
    const badge = cnt ? `<span class="badge">${cnt}</span>` : "";
    const classes = ["day", c.off ? "off" : "", c.ymd === selectedDate ? "sel" : ""].join(" ");
    return `<div class="${classes}" data-ymd="${c.ymd}">
      <div class="num">${c.label}</div>${badge}
    </div>`;
  }).join("");

  [...document.querySelectorAll(".day")].forEach(el => {
    el.addEventListener("click", () => {
      selectedDate = el.dataset.ymd;
      renderCalendar();
      renderDay();
    });
  });

  $("selDate").value = `${humanDate(selectedDate)} (${selectedDate})`;
}

function renderDay(){
  $("selDate").value = `${humanDate(selectedDate)} (${selectedDate})`;

  const list = $("apptList");
  const dayAppts = appointments
    .filter(a => a.date === selectedDate)
    .sort((a,b) => (a.time||"").localeCompare(b.time||""));

  $("dayHint").textContent = dayAppts.length
    ? `Atendimentos do dia (${dayAppts.length})`
    : "Sem agendamentos nesse dia. Você pode criar um agora.";

  list.innerHTML = dayAppts.map(a => {
    const p = patients.find(x => x.id === a.patientId);
    const pname = p ? p.name : "(Paciente removido)";
    const pill = `<span class="pill">${escapeHtml(a.status||"")}</span>`;
    const note = a.note ? `• ${escapeHtml(a.note)}` : "";
    return `<div class="item">
      <div>
        <b>${escapeHtml(a.time || "--:--")} — ${escapeHtml(pname)} ${pill}</b>
        <small>${note}</small>
      </div>
      <div class="mini-btns">
        <button class="btn" data-edit="${a.id}">Editar</button>
        <button class="btn-bad" data-del="${a.id}">Apagar</button>
      </div>
    </div>`;
  }).join("");

  // binds
  [...list.querySelectorAll("[data-del]")].forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.del;
      await dbDelete("appointments", id);
      await loadAll();
      renderCalendar();
      renderDay();
    });
  });

  [...list.querySelectorAll("[data-edit]")].forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.edit;
      const a = appointments.find(x => x.id === id);
      if (!a) return;

      $("selPatient").value = a.patientId || "";
      $("apptTime").value = a.time || "";
      $("apptStatus").value = a.status || "Confirmado";
      $("apptNote").value = a.note || "";

      // ao salvar, a gente atualiza o mesmo ID
      $("btnAddAppt").dataset.editing = id;
      $("btnAddAppt").textContent = "Atualizar agendamento";
    });
  });
}

/* ------------------ AÇÕES: AGENDA ------------------ */
$("btnAddAppt").addEventListener("click", async () => {
  const patientId = $("selPatient").value;
  const time = $("apptTime").value || "";
  const status = $("apptStatus").value || "Confirmado";
  const note = $("apptNote").value || "";

  if (!selectedDate){
    alert("Selecione um dia no calendário.");
    return;
  }
  if (!patientId){
    alert("Selecione um paciente para agendar.");
    return;
  }
  if (!time){
    alert("Informe a hora.");
    return;
  }

  const editingId = $("btnAddAppt").dataset.editing || "";

  const appt = {
    id: editingId || newId(),
    date: selectedDate,
    time,
    patientId,
    status,
    note,
    createdAt: new Date().toISOString()
  };

  await dbPut("appointments", appt);

  // reset modo edição
  delete $("btnAddAppt").dataset.editing;
  $("btnAddAppt").textContent = "Salvar agendamento";
  $("apptNote").value = "";

  await loadAll();
  renderCalendar();
  renderDay();
});

$("btnPrintDay").addEventListener("click", () => {
  const dayAppts = appointments
    .filter(a => a.date === selectedDate)
    .sort((a,b) => (a.time||"").localeCompare(b.time||""));

  const html = `
    <div class="p-head">
      <div>
        <h3>Agenda do Dia</h3>
        <small>${escapeHtml(humanDate(selectedDate))}<br/>Data: ${selectedDate}</small>
      </div>
      <div style="text-align:right">
        <small><b>BTX • Agenda</b><br/>Gerado em ${new Date().toLocaleString("pt-BR")}</small>
      </div>
    </div>
    <div class="rx-body" style="min-height:auto">
      ${dayAppts.length ? dayAppts.map(a=>{
        const p = patients.find(x=>x.id===a.patientId);
        const pname = p ? p.name : "(Paciente removido)";
        const line = `${a.time||"--:--"} — ${pname} — ${a.status||""}${a.note? " • "+a.note:""}`;
        return escapeHtml(line);
      }).join("<br/>") : "<i>Sem agendamentos.</i>"}
    </div>
  `;

  $("printPaper").innerHTML = html;
  window.print();
});

$("btnPdfDay").addEventListener("click", async () => {
  if (!window.jspdf?.jsPDF){
    alert("jsPDF não carregou. Verifique sua internet na primeira vez (depois cacheia).");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });

  const dayAppts = appointments
    .filter(a => a.date === selectedDate)
    .sort((a,b) => (a.time||"").localeCompare(b.time||""));

  const title = `Agenda do Dia — ${selectedDate}`;
  doc.setFont("helvetica","bold");
  doc.setFontSize(14);
  doc.text(title, 40, 60);

  doc.setFont("helvetica","normal");
  doc.setFontSize(11);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 40, 80);

  let y = 110;
  const maxY = 780;

  const lines = dayAppts.length ? dayAppts.map(a=>{
    const p = patients.find(x=>x.id===a.patientId);
    const pname = p ? p.name : "(Paciente removido)";
    return `${a.time||"--:--"} — ${pname} — ${a.status||""}${a.note? " • "+a.note:""}`;
  }) : ["Sem agendamentos."];

  for (const line of lines){
    const wrapped = doc.splitTextToSize(line, 520);
    for (const w of wrapped){
      doc.text(w, 40, y);
      y += 16;
      if (y > maxY){
        doc.addPage();
        y = 60;
      }
    }
  }

  doc.save(`agenda-${selectedDate}.pdf`);
});

/* ------------------ PACIENTES ------------------ */
$("btnSavePatient").addEventListener("click", async () => {
  const name = ($("pName").value || "").trim();
  const phone = ($("pPhone").value || "").trim();
  const dob = $("pDob").value || "";
  const docId = ($("pDoc").value || "").trim();

  if (!name){
    alert("Informe o nome do paciente.");
    return;
  }

  const patient = { id:newId(), name, phone, dob, doc:docId, createdAt:new Date().toISOString() };
  await dbPut("patients", patient);

  $("pName").value = "";
  $("pPhone").value = "";
  $("pDob").value = "";
  $("pDoc").value = "";

  await loadAll();
  fillPatientSelects();
  renderDay();
});

/* ------------------ RECEITA ------------------ */
$("rxDate").value = ymd(new Date());

function buildRxHTML(){
  const patientId = $("rxPatient").value;
  const rxDate = $("rxDate").value || ymd(new Date());
  const text = ($("rxText").value || "").trim();

  const p = patients.find(x=>x.id===patientId);
  const pname = p ? p.name : "—";

  // Aqui você pode mudar pra seus dados fixos depois (CRM/CRO etc.)
  const profName = "BTX • Profissional";
  const profInfo = "Dados do profissional (edite no código ou eu faço uma tela Settings depois)";

  const body = text ? escapeHtml(text) : "<i>(Digite o texto da receita)</i>";

  return `
    <div class="p-head">
      <div>
        <h3>${escapeHtml(profName)}</h3>
        <small>${escapeHtml(profInfo)}</small>
      </div>
      <div style="text-align:right">
        <small><b>Data:</b> ${escapeHtml(rxDate)}<br/><b>Paciente:</b> ${escapeHtml(pname)}</small>
      </div>
    </div>
    <div class="rx-title">RECEITA</div>
    <div class="rx-body">${body}</div>
    <div class="p-foot">
      <div>Assinatura: ____________________________</div>
      <div>Gerado em ${new Date().toLocaleString("pt-BR")}</div>
    </div>
  `;
}

$("btnPreviewRx").addEventListener("click", () => {
  $("rxPreview").innerHTML = buildRxHTML();
});
$("btnPrintRx").addEventListener("click", () => {
  $("printPaper").innerHTML = buildRxHTML();
  window.print();
});

$("btnPdfRx").addEventListener("click", async () => {
  if (!window.jspdf?.jsPDF){
    alert("jsPDF não carregou. Verifique sua internet na primeira vez (depois cacheia).");
    return;
  }
  const patientId = $("rxPatient").value;
  const rxDate = $("rxDate").value || ymd(new Date());
  const text = ($("rxText").value || "").trim();

  if (!patientId){
    alert("Selecione o paciente.");
    return;
  }
  if (!text){
    alert("Digite o texto da receita.");
    return;
  }

  const p = patients.find(x=>x.id===patientId);
  const pname = p ? p.name : "Paciente";

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });

  // Cabeçalho
  doc.setFont("helvetica","bold"); doc.setFontSize(14);
  doc.text("RECEITA", 297, 70, { align:"center" });

  doc.setFont("helvetica","normal"); doc.setFontSize(11);
  doc.text(`Paciente: ${pname}`, 40, 100);
  doc.text(`Data: ${rxDate}`, 40, 118);

  // Corpo (com quebra correta + preserva espaçamento)
  const lines = text.split("\n");
  let y = 150;
  const maxY = 780;

  for (const raw of lines){
    const line = raw.trimEnd();
    if (!line){
      y += 14; // linha em branco = espaço real no PDF
      continue;
    }
    const wrapped = doc.splitTextToSize(line, 520);
    for (const w of wrapped){
      doc.text(w, 40, y);
      y += 16;
      if (y > maxY){
        doc.addPage();
        y = 60;
      }
    }
  }

  // Rodapé
  doc.setFontSize(10);
  doc.text("Assinatura: ________________________________", 40, 820);

  doc.save(`receita-${pname}-${rxDate}.pdf`.replaceAll(" ","_"));
});

/* ------------------ MODAL: GERENCIAR PACIENTES ------------------ */
const modalBack = $("modalBack");
$("btnManagePatients").addEventListener("click", () => {
  modalBack.style.display = "flex";
  renderPatientManager();
});
$("btnCloseModal").addEventListener("click", () => modalBack.style.display = "none");
modalBack.addEventListener("click", (e) => {
  if (e.target === modalBack) modalBack.style.display = "none";
});
$("pSearch").addEventListener("input", renderPatientManager);

function renderPatientManager(){
  const q = ($("pSearch").value || "").toLowerCase().trim();
  const list = $("patientList");

  const filtered = patients.filter(p =>
    !q || (p.name||"").toLowerCase().includes(q) || (p.phone||"").toLowerCase().includes(q)
  );

  list.innerHTML = filtered.map(p => `
    <div class="item">
      <div>
        <b>${escapeHtml(p.name)}</b>
        <small>${escapeHtml(p.phone || "")} ${p.dob ? "• Nasc: "+escapeHtml(p.dob) : ""} ${p.doc ? "• Doc: "+escapeHtml(p.doc) : ""}</small>
      </div>
      <div class="mini-btns">
        <button class="btn-bad" data-pdel="${p.id}">Apagar</button>
      </div>
    </div>
  `).join("") || `<div class="hint">Nenhum paciente encontrado.</div>`;

  [...list.querySelectorAll("[data-pdel]")].forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.pdel;
      await dbDelete("patients", id);
      await loadAll();
      fillPatientSelects();
      renderCalendar();
      renderDay();
      renderPatientManager();
    });
  });
}

$("btnDeleteAllPatients").addEventListener("click", async () => {
  if (!confirm("Apagar TODOS os pacientes? (agendamentos ficam no histórico)")) return;
  await dbClear("patients");
  await loadAll();
  fillPatientSelects();
  renderCalendar();
  renderDay();
  renderPatientManager();
});

$("btnExportPatients").addEventListener("click", () => {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), patients }, null, 2);
  downloadFile("pacientes-btx.json", data);
});

/* ------------------ BACKUP / RESTORE / WIPE ------------------ */
$("btnBackup").addEventListener("click", async () => {
  const payload = await exportAll();
  downloadFile(`btx-backup-${ymd(new Date())}.json`, JSON.stringify(payload, null, 2));
});

$("fileRestore").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try{
    const payload = JSON.parse(text);
    await importAll(payload);
    await loadAll();
    fillPatientSelects();
    renderCalendar();
    renderDay();
    $("rxPreview").innerHTML = buildRxHTML();
    alert("Backup importado com sucesso.");
  }catch(err){
    alert("Falha ao importar backup. Arquivo inválido.");
  } finally {
    e.target.value = "";
  }
});

$("btnWipe").addEventListener("click", async () => {
  if (!confirm("Tem certeza que deseja apagar TUDO? (pacientes + agenda + configs)")) return;
  await dbClear("patients");
  await dbClear("appointments");
  await dbClear("settings");
  await loadAll();
  fillPatientSelects();
  renderCalendar();
  renderDay();
  $("rxPreview").innerHTML = buildRxHTML();
});

/* ------------------ START ------------------ */
(async function start(){
  await bootDemoIfEmpty();
  await loadAll();
  fillPatientSelects();

  // data selecionada e view do calendário
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  selectedDate = ymd(now);

  renderCalendar();
  renderDay();

  // inicia preview
  $("rxPreview").innerHTML = buildRxHTML();
})();
