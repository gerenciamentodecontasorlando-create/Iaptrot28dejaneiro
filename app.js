import { dbPut, dbGetAll, dbDelete, dbClear, newId, exportAll, importAll } from "./db.js";

const $ = (id) => document.getElementById(id);
const statusLine = $("statusLine");
const btnInstall = $("btnInstall");

/* ==================== PWA Install ==================== */
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

/* ==================== Utils ==================== */
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
function escapeHtml(s=""){
  return s.replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
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
function ensureJsPDF(){
  return !!window.jspdf?.jsPDF;
}
function ensureHtml2Canvas(){
  return !!window.html2canvas;
}

/* ==================== Data ==================== */
let patients = [];
let appointments = [];
let records = [];
let prof = { name:"", reg:"", phone:"", email:"", addr:"" };

async function bootDemoIfEmpty(){
  const ps = await dbGetAll("patients");
  if (ps.length) return;

  const p1 = { id:newId(), name:"Paciente Teste", phone:"(91) 99999-0000", dob:"", doc:"", createdAt: new Date().toISOString() };
  await dbPut("patients", p1);

  const today = ymd(new Date());
  const a1 = { id:newId(), date: today, time:"09:00", patientId:p1.id, status:"Confirmado", note:"Consulta teste", createdAt:new Date().toISOString() };
  await dbPut("appointments", a1);

  const r1 = { id:newId(), patientId:p1.id, date: today, S:"Teste de prontuário", O:"-", A:"-", P:"-", createdAt:new Date().toISOString() };
  await dbPut("records", r1);
}

async function loadAll(){
  patients = await dbGetAll("patients");
  appointments = await dbGetAll("appointments");
  records = await dbGetAll("records");

  patients.sort((a,b) => (a.name||"").localeCompare(b.name||"", "pt-BR"));
  appointments.sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  records.sort((a,b) => (b.date+b.createdAt).localeCompare(a.date+a.createdAt));
}

/* ==================== Professional settings ==================== */
function profLineText(){
  const lines = [];
  if (prof.reg) lines.push(prof.reg);
  const contact = [prof.phone, prof.email].filter(Boolean).join(" • ");
  if (contact) lines.push(contact);
  if (prof.addr) lines.push(prof.addr);
  return lines.join("\n");
}
function profLineHTML(){
  return escapeHtml(profLineText()).replaceAll("\n","<br/>");
}
function readProfFromInputs(){
  // GARANTE que o PDF pega o que está na tela (mesmo se o objeto prof estiver desatualizado)
  return {
    name: ($("proName")?.value || "").trim(),
    reg:  ($("proReg")?.value || "").trim(),
    phone: ($("proPhone")?.value || "").trim(),
    email: ($("proEmail")?.value || "").trim(),
    addr:  ($("proAddr")?.value || "").trim()
  };
}

async function loadProfessional(){
  const settings = await dbGetAll("settings");
  const map = new Map(settings.map(s => [s.key, s.value]));
  prof = {
    name: map.get("pro_name") || "",
    reg:  map.get("pro_reg") || "",
    phone: map.get("pro_phone") || "",
    email: map.get("pro_email") || "",
    addr:  map.get("pro_addr") || ""
  };

  $("proName").value = prof.name;
  $("proReg").value = prof.reg;
  $("proPhone").value = prof.phone;
  $("proEmail").value = prof.email;
  $("proAddr").value = prof.addr;
}

async function saveProfessional(){
  prof = readProfFromInputs();

  await dbPut("settings", { key:"pro_name", value: prof.name });
  await dbPut("settings", { key:"pro_reg", value: prof.reg });
  await dbPut("settings", { key:"pro_phone", value: prof.phone });
  await dbPut("settings", { key:"pro_email", value: prof.email });
  await dbPut("settings", { key:"pro_addr", value: prof.addr });
}

/* ==================== UI fill ==================== */
function fillPatientSelects(){
  const opts = [`<option value="">— Selecione —</option>`]
    .concat(patients.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`));

  $("selPatient").innerHTML = opts.join("");
  $("rxPatient").innerHTML = opts.join("");
  $("recPatient").innerHTML = opts.join("");

  statusLine.textContent = patients.length
    ? "Offline-first • Memória local (IndexedDB) • PDF/Impressão"
    : "Crie pelo menos 1 paciente para agendar, receitar e registrar prontuário.";
}

/* ==================== Calendar ==================== */
const dowNames = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
$("dowRow").innerHTML = dowNames.map(d => `<div class="dow">${d}</div>`).join("");

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
  const prevDays = new Date(viewYear, viewMonth, 0).getDate();

  const cells = [];
  for (let i=0; i<startDow; i++){
    const dayNum = prevDays - (startDow-1-i);
    const dt = new Date(viewYear, viewMonth-1, dayNum);
    cells.push({ label: dayNum, ymd: ymd(dt), off:true });
  }
  for (let d=1; d<=daysInMonth; d++){
    const dt = new Date(viewYear, viewMonth, d);
    cells.push({ label:d, ymd: ymd(dt), off:false });
  }
  while (cells.length % 7 !== 0){
    const last = new Date(cells[cells.length-1].ymd);
    last.setDate(last.getDate()+1);
    cells.push({ label:last.getDate(), ymd: ymd(last), off:true });
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

  list.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await dbDelete("appointments", btn.dataset.del);
      await loadAll();
      renderCalendar(); renderDay();
    });
  });

  list.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const a = appointments.find(x => x.id === btn.dataset.edit);
      if (!a) return;

      $("selPatient").value = a.patientId || "";
      $("apptTime").value = a.time || "";
      $("apptStatus").value = a.status || "Confirmado";
      $("apptNote").value = a.note || "";

      $("btnAddAppt").dataset.editing = a.id;
      $("btnAddAppt").textContent = "Atualizar agendamento";
    });
  });
}

$("btnAddAppt").addEventListener("click", async () => {
  const patientId = $("selPatient").value;
  const time = $("apptTime").value || "";
  const status = $("apptStatus").value || "Confirmado";
  const note = $("apptNote").value || "";

  if (!selectedDate) return alert("Selecione um dia no calendário.");
  if (!patientId) return alert("Selecione um paciente para agendar.");
  if (!time) return alert("Informe a hora.");

  const editingId = $("btnAddAppt").dataset.editing || "";
  const appt = {
    id: editingId || newId(),
    date: selectedDate, time, patientId, status, note,
    createdAt: new Date().toISOString()
  };

  await dbPut("appointments", appt);

  delete $("btnAddAppt").dataset.editing;
  $("btnAddAppt").textContent = "Salvar agendamento";
  $("apptNote").value = "";

  await loadAll();
  renderCalendar(); renderDay();
});

/* ==================== Printing helpers ==================== */
function setPrintPaper(html){
  $("printPaper").innerHTML = html;
}
function printNow(html){
  setPrintPaper(html);
  window.print();
}

/* ==================== Agenda Print/PDF (texto) ==================== */
function buildDayPaperHTML(){
  const dayAppts = appointments
    .filter(a => a.date === selectedDate)
    .sort((a,b) => (a.time||"").localeCompare(b.time||""));

  const pNow = readProfFromInputs();
  prof = pNow;

  const proName = escapeHtml(prof.name || "Profissional");
  const proInfo = (profLineHTML() || "—");

  return `
    <div class="p-head">
      <div>
        <h3>${proName}</h3>
        <small>${proInfo}</small>
      </div>
      <div style="text-align:right">
        <small><b>AGENDA DO DIA</b><br/>${escapeHtml(humanDate(selectedDate))}<br/>${selectedDate}</small>
      </div>
    </div>
    <div class="doc-body" style="min-height:auto">
      ${dayAppts.length ? dayAppts.map(a=>{
        const p = patients.find(x=>x.id===a.patientId);
        const pname = p ? p.name : "(Paciente removido)";
        const line = `${a.time||"--:--"} — ${pname} — ${a.status||""}${a.note? " • "+a.note:""}`;
        return escapeHtml(line);
      }).join("<br/>") : "<i>Sem agendamentos.</i>"}
    </div>
    <div class="p-foot">
      <div>Gerado em ${escapeHtml(new Date().toLocaleString("pt-BR"))}</div>
      <div>—</div>
    </div>
  `;
}

$("btnPrintDay").addEventListener("click", () => printNow(buildDayPaperHTML()));

$("btnPdfDay").addEventListener("click", () => {
  if (!ensureJsPDF()) return alert("jsPDF não carregou.");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });

  const pNow = readProfFromInputs();
  prof = pNow;

  const proName = prof.name || "Profissional";
  const proInfo = profLineText() || "—";

  doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text(proName, 40, 60);

  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  const infoLines = doc.splitTextToSize(proInfo, 520);
  doc.text(infoLines, 40, 78);

  doc.setFont("helvetica","bold"); doc.setFontSize(12);
  doc.text(`AGENDA DO DIA — ${selectedDate}`, 40, 140);

  doc.setFont("helvetica","normal"); doc.setFontSize(11);

  const dayAppts = appointments
    .filter(a => a.date === selectedDate)
    .sort((a,b) => (a.time||"").localeCompare(b.time||""));

  const lines = dayAppts.length ? dayAppts.map(a=>{
    const p = patients.find(x=>x.id===a.patientId);
    const pname = p ? p.name : "(Paciente removido)";
    return `${a.time||"--:--"} — ${pname} — ${a.status||""}${a.note? " • "+a.note:""}`;
  }) : ["Sem agendamentos."];

  let y = 170;
  const maxY = 780;
  for (const line of lines){
    const wrapped = doc.splitTextToSize(line, 520);
    for (const w of wrapped){
      doc.text(w, 40, y);
      y += 16;
      if (y > maxY){ doc.addPage(); y = 60; }
    }
  }

  doc.save(`agenda-${selectedDate}.pdf`);
});

/* ==================== Patients ==================== */
$("btnSavePatient").addEventListener("click", async () => {
  const name = ($("pName").value || "").trim();
  const phone = ($("pPhone").value || "").trim();
  const dob = $("pDob").value || "";
  const docId = ($("pDoc").value || "").trim();
  if (!name) return alert("Informe o nome do paciente.");

  const patient = { id:newId(), name, phone, dob, doc:docId, createdAt:new Date().toISOString() };
  await dbPut("patients", patient);

  $("pName").value = ""; $("pPhone").value = ""; $("pDob").value = ""; $("pDoc").value = "";

  await loadAll();
  fillPatientSelects();
  renderCalendar(); renderDay();
  renderRecordHistory();
  renderRxPreview();
});

/* ==================== Modal Patient Manager ==================== */
const modalBack = $("modalBack");
$("btnManagePatients").addEventListener("click", () => {
  modalBack.style.display = "flex";
  renderPatientManager();
});
$("btnCloseModal").addEventListener("click", () => modalBack.style.display = "none");
modalBack.addEventListener("click", (e) => { if (e.target === modalBack) modalBack.style.display = "none"; });
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

  list.querySelectorAll("[data-pdel]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await dbDelete("patients", btn.dataset.pdel);
      await loadAll();
      fillPatientSelects();
      renderCalendar(); renderDay();
      renderPatientManager();
      renderRecordHistory();
      renderRxPreview();
    });
  });
}

$("btnDeleteAllPatients").addEventListener("click", async () => {
  if (!confirm("Apagar TODOS os pacientes?")) return;
  await dbClear("patients");
  await loadAll();
  fillPatientSelects();
  renderCalendar(); renderDay();
  renderPatientManager();
  renderRecordHistory();
  renderRxPreview();
});

$("btnExportPatients").addEventListener("click", () => {
  downloadFile("pacientes-btx.json", JSON.stringify({ exportedAt: new Date().toISOString(), patients }, null, 2));
});

/* ==================== Receita (HTML/PAPER) ==================== */
$("rxDate").value = ymd(new Date());

function buildRxHTML(){
  // Garante que o preview sempre usa o que está na tela
  prof = readProfFromInputs();

  const patientId = $("rxPatient").value;
  const rxDate = $("rxDate").value || ymd(new Date());
  const text = ($("rxText").value || "").trim();
  const p = patients.find(x=>x.id===patientId);
  const pname = p ? p.name : "—";

  const proName = escapeHtml(prof.name || "Profissional");
  const proInfo = profLineHTML() || "—";
  const body = text ? escapeHtml(text) : "<i>(Digite o texto da receita)</i>";

  return `
    <div class="p-head">
      <div>
        <h3>${proName}</h3>
        <small>${proInfo}</small>
      </div>
      <div style="text-align:right">
        <small><b>Data:</b> ${escapeHtml(rxDate)}<br/><b>Paciente:</b> ${escapeHtml(pname)}</small>
      </div>
    </div>
    <div class="doc-title">RECEITA</div>
    <div class="doc-body">${body}</div>
    <div class="p-foot">
      <div>Assinatura: ____________________________</div>
      <div>Gerado em ${escapeHtml(new Date().toLocaleString("pt-BR"))}</div>
    </div>
  `;
}

function renderRxPreview(){
  $("rxPreview").innerHTML = buildRxHTML();
}

$("btnPreviewRx").addEventListener("click", renderRxPreview);
$("btnPrintRx").addEventListener("click", () => printNow(buildRxHTML()));

/* ==================== PDF PERFEITO (HTML -> Canvas -> PDF) ==================== */
async function pdfFromElement(element, filename){
  if (!ensureHtml2Canvas()) {
    alert("html2canvas não carregou. Verifique o script no index.html.");
    return;
  }
  if (!ensureJsPDF()) {
    alert("jsPDF não carregou.");
    return;
  }

  // força o preview a estar atualizado e completo
  renderRxPreview();

  const { jsPDF } = window.jspdf;

  // captura o elemento com qualidade alta
  const canvas = await window.html2canvas(element, {
    scale: 2.2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false
  });

  const imgData = canvas.toDataURL("image/png", 1.0);

  const pdf = new jsPDF({ unit:"pt", format:"a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // margens
  const margin = 36; // ~12mm
  const maxW = pageW - margin*2;
  const maxH = pageH - margin*2;

  // proporção
  const imgW = canvas.width;
  const imgH = canvas.height;
  const ratio = Math.min(maxW / imgW, maxH / imgH);

  const drawW = imgW * ratio;
  const drawH = imgH * ratio;

  const x = (pageW - drawW)/2;
  const y = margin;

  pdf.addImage(imgData, "PNG", x, y, drawW, drawH, undefined, "FAST");
  pdf.save(filename);
}

$("btnPdfRx").addEventListener("click", async () => {
  const patientId = $("rxPatient").value;
  const rxDate = $("rxDate").value || ymd(new Date());
  const text = ($("rxText").value || "").trim();

  if (!patientId) return alert("Selecione o paciente.");
  if (!text) return alert("Digite o texto da receita.");

  const p = patients.find(x=>x.id===patientId);
  const pname = p ? p.name : "Paciente";

  // Gera PDF do preview (igualzinho)
  await pdfFromElement($("rxPreview"), `receita-${pname}-${rxDate}.pdf`.replaceAll(" ","_"));
});

/* ==================== Prontuário SOAP ==================== */
$("recDate").value = ymd(new Date());

function renderRecordHistory(){
  const pid = $("recPatient").value || "";
  const box = $("recordList");

  const filtered = records
    .filter(r => r.patientId === pid)
    .sort((a,b)=> (b.date+b.createdAt).localeCompare(a.date+a.createdAt))
    .slice(0, 10);

  box.innerHTML = filtered.map(r => `
    <div class="item">
      <div style="flex:1">
        <b>${escapeHtml(r.date)} <span class="pill">SOAP</span></b>
        <small><b>S:</b> ${escapeHtml((r.S||"").slice(0,120))}${(r.S||"").length>120?"…":""}</small>
        <small><b>A:</b> ${escapeHtml((r.A||"").slice(0,120))}${(r.A||"").length>120?"…":""}</small>
      </div>
      <div class="mini-btns">
        <button class="btn" data-rload="${r.id}">Abrir</button>
        <button class="btn-bad" data-rdel="${r.id}">Apagar</button>
      </div>
    </div>
  `).join("") || `<div class="hint">Sem evoluções ainda para esse paciente.</div>`;

  box.querySelectorAll("[data-rdel]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      await dbDelete("records", btn.dataset.rdel);
      await loadAll();
      renderRecordHistory();
    });
  });

  box.querySelectorAll("[data-rload]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const r = records.find(x=>x.id===btn.dataset.rload);
      if (!r) return;
      $("recDate").value = r.date || ymd(new Date());
      $("recS").value = r.S || "";
      $("recO").value = r.O || "";
      $("recA").value = r.A || "";
      $("recP").value = r.P || "";
      $("btnSaveRecord").dataset.editing = r.id;
      $("btnSaveRecord").textContent = "Atualizar evolução";
    });
  });
}

$("btnLoadPatientHistory").addEventListener("click", renderRecordHistory);
$("recPatient").addEventListener("change", renderRecordHistory);

$("btnSaveRecord").addEventListener("click", async ()=>{
  const pid = $("recPatient").value;
  const date = $("recDate").value || ymd(new Date());
  if (!pid) return alert("Selecione o paciente.");

  const editingId = $("btnSaveRecord").dataset.editing || "";

  const rec = {
    id: editingId || newId(),
    patientId: pid,
    date,
    S: $("recS").value || "",
    O: $("recO").value || "",
    A: $("recA").value || "",
    P: $("recP").value || "",
    createdAt: new Date().toISOString()
  };

  await dbPut("records", rec);
  delete $("btnSaveRecord").dataset.editing;
  $("btnSaveRecord").textContent = "Salvar evolução";

  await loadAll();
  renderRecordHistory();
  alert("Evolução salva.");
});

/* Impressão prontuário segue HTML */
function buildRecordPaperHTML(){
  prof = readProfFromInputs();

  const pid = $("recPatient").value || "";
  const date = $("recDate").value || ymd(new Date());
  const p = patients.find(x=>x.id===pid);
  const pname = p ? p.name : "—";

  const proName = escapeHtml(prof.name || "Profissional");
  const proInfo = profLineHTML() || "—";

  const S = ($("recS").value || "").trim();
  const O = ($("recO").value || "").trim();
  const A = ($("recA").value || "").trim();
  const P = ($("recP").value || "").trim();

  const block = (title, text) => `
    <b>${title}</b><br/>
    ${escapeHtml(text || "-").replaceAll("\n","<br/>")}<br/><br/>
  `;

  return `
    <div class="p-head">
      <div>
        <h3>${proName}</h3>
        <small>${proInfo}</small>
      </div>
      <div style="text-align:right">
        <small><b>PRONTUÁRIO • SOAP</b><br/>Paciente: <b>${escapeHtml(pname)}</b><br/>Data: ${escapeHtml(date)}</small>
      </div>
    </div>
    <div class="doc-body" style="min-height:auto">
      ${block("S (Subjetivo)", S)}
      ${block("O (Objetivo)", O)}
      ${block("A (Avaliação)", A)}
      ${block("P (Plano)", P)}
    </div>
    <div class="p-foot">
      <div>Assinatura: ____________________________</div>
      <div>Gerado em ${escapeHtml(new Date().toLocaleString("pt-BR"))}</div>
    </div>
  `;
}

$("btnPrintRecord").addEventListener("click", ()=>{
  if (!$("recPatient").value) return alert("Selecione o paciente do prontuário.");
  printNow(buildRecordPaperHTML());
});

/* PDF prontuário pode ser igual ao HTML também (perfeito) */
$("btnPdfRecord").addEventListener("click", async ()=>{
  if (!$("recPatient").value) return alert("Selecione o paciente do prontuário.");
  // cria um preview temporário usando o printPaper (sem mexer no UI)
  $("printPaper").innerHTML = buildRecordPaperHTML();
  const pid = $("recPatient").value;
  const p = patients.find(x=>x.id===pid);
  const pname = p ? p.name : "Paciente";
  const date = $("recDate").value || ymd(new Date());
  await pdfFromElement($("printPaper"), `prontuario-${pname}-${date}.pdf`.replaceAll(" ","_"));
  $("printPaper").innerHTML = "";
});

/* ==================== Backup/Restore/Wipe ==================== */
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
    await loadProfessional();
    fillPatientSelects();
    renderCalendar(); renderDay();
    renderRxPreview();
    renderRecordHistory();
    alert("Backup importado com sucesso.");
  }catch{
    alert("Falha ao importar backup. Arquivo inválido.");
  } finally {
    e.target.value = "";
  }
});

$("btnWipe").addEventListener("click", async () => {
  if (!confirm("Tem certeza que deseja apagar TUDO?")) return;
  await dbClear("patients");
  await dbClear("appointments");
  await dbClear("records");
  await dbClear("settings");
  await loadAll();
  prof = { name:"", reg:"", phone:"", email:"", addr:"" };
  fillPatientSelects();
  renderCalendar(); renderDay();
  renderRxPreview();
  renderRecordHistory();
  await loadProfessional().catch(()=>{});
});

/* ==================== Professional UI binds ==================== */
$("btnSavePro").addEventListener("click", async () => {
  await saveProfessional();
  renderRxPreview();
  renderCalendar(); renderDay();
  renderRecordHistory();
  alert("Dados do profissional salvos.");
});
$("btnLoadPro").addEventListener("click", async () => {
  await loadProfessional();
  renderRxPreview();
  alert("Dados do profissional carregados.");
});

/* ==================== START ==================== */
(async function start(){
  await bootDemoIfEmpty();
  await loadAll();
  fillPatientSelects();

  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  selectedDate = ymd(now);

  $("rxDate").value = ymd(now);
  $("recDate").value = ymd(now);

  await loadProfessional().catch(()=>{});

  renderCalendar();
  renderDay();
  renderRxPreview();
  renderRecordHistory();
})();
