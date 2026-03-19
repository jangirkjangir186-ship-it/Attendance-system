// ═══════════════════════════════════════════════════════
//   AttendX — Smart Attendance System
//   script.js
//
//   Features:
//   1. QR Code Scanning (real camera)
//   2. QR Code Generation per student
//   3. Face Detection Mode (camera-based)
//   4. Student Management (add/delete)
//   5. Attendance Reports + CSV export
//   6. localStorage persistence
// ═══════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────────────
let students    = JSON.parse(localStorage.getItem('ax_students')    || '[]');
let attendLogs  = JSON.parse(localStorage.getItem('ax_logs')        || '[]');
let qrStream    = null;   // QR camera stream
let faceStream  = null;   // Face camera stream
let qrInterval  = null;   // QR scanning interval
let faceInterval = null;  // Face detection interval
let torchOn     = false;
let faceDetected = false;

// ── Demo students (if empty) ───────────────────────────────────────────────────
if (students.length === 0) {
  students = [
    { id:'STU001', name:'Rahul Sharma',   cls:'12-A', roll:'01' },
    { id:'STU002', name:'Priya Singh',    cls:'12-A', roll:'02' },
    { id:'STU003', name:'Amit Kumar',     cls:'12-B', roll:'01' },
    { id:'STU004', name:'Sneha Patel',    cls:'12-B', roll:'02' },
    { id:'STU005', name:'Vikram Rao',     cls:'11-A', roll:'01' },
    { id:'STU006', name:'Anjali Gupta',   cls:'11-A', roll:'02' },
    { id:'STU007', name:'Ravi Verma',     cls:'11-B', roll:'01' },
    { id:'STU008', name:'Pooja Sharma',   cls:'11-B', roll:'02' },
  ];
  save();
}

// ── Save to localStorage ───────────────────────────────────────────────────────
function save() {
  localStorage.setItem('ax_students', JSON.stringify(students));
  localStorage.setItem('ax_logs',     JSON.stringify(attendLogs));
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');

  // Stop cameras when switching away
  if (id !== 'qr-scan'  && qrStream)   stopQRScan();
  if (id !== 'face'     && faceStream) stopFaceMode();

  // Page-specific init
  if (id === 'dashboard') renderDashboard();
  if (id === 'qr-gen')    { populateStudentDropdowns(); renderAllQRIfNeeded(); }
  if (id === 'students')  renderStudentList();
  if (id === 'reports')   { populateReportDropdown(); renderReports(); }
  if (id === 'face')      populateStudentDropdowns();
  if (id === 'qr-scan')   populateStudentDropdowns();
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('navTime').textContent =
    now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

  const h = now.getHours();
  document.getElementById('timeOfDay').textContent =
    h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}
setInterval(updateClock, 1000);
updateClock();

// ── Today's date ───────────────────────────────────────────────────────────────
const todayStr = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
document.getElementById('todayDate').textContent = todayStr;
// Set report date default
document.getElementById('reportDate').value = new Date().toISOString().split('T')[0];

// ═══════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════
function renderDashboard() {
  const todayKey  = new Date().toISOString().split('T')[0];
  const todayLogs = attendLogs.filter(l => l.date === todayKey);
  const presentIds = [...new Set(todayLogs.map(l => l.studentId))];

  const total   = students.length;
  const present = presentIds.length;
  const absent  = total - present;
  const pct     = total > 0 ? Math.round((present/total)*100) : 0;

  document.getElementById('statTotal').textContent   = total;
  document.getElementById('statPresent').textContent = present;
  document.getElementById('statAbsent').textContent  = absent;
  document.getElementById('statPct').textContent     = pct + '%';

  // Ring
  const circumference = 314;
  const offset = circumference - (pct/100) * circumference;
  const ring = document.getElementById('dashRing');
  ring.style.strokeDashoffset = offset;
  ring.style.stroke = pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';
  document.getElementById('ringPct').textContent = pct + '%';
  document.getElementById('ringPct').style.color =
    pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';

  // Recent log
  const el = document.getElementById('recentLog');
  const recent = todayLogs.slice(-8).reverse();
  if (!recent.length) { el.innerHTML = '<div class="log-empty">No check-ins yet today</div>'; return; }
  el.innerHTML = recent.map(l => {
    const stu = students.find(s => s.id === l.studentId);
    return `<div class="log-item">
      <div class="log-dot p"></div>
      <div class="log-name">${stu ? stu.name : l.studentId}</div>
      <span class="log-method">${l.method}</span>
      <div class="log-time">${l.time}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
//  QR CODE SCANNING
// ═══════════════════════════════════════════════════════
async function startQRScan() {
  try {
    const video = document.getElementById('qrVideo');
    document.getElementById('camOff').style.display = 'none';
    document.getElementById('scanStatus').textContent = 'Starting camera…';

    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
    });
    video.srcObject = qrStream;
    await video.play();

    document.getElementById('startScanBtn').style.display = 'none';
    document.getElementById('stopScanBtn').style.display  = '';
    document.getElementById('torchBtn').style.display     = '';
    document.getElementById('scanStatus').textContent = '🟢 Camera active — point at QR code';

    // Start scanning frames
    const canvas = document.getElementById('qrCanvas');
    const ctx    = canvas.getContext('2d');

    qrInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (code) {
          processQRCode(code.data);
        }
      }
    }, 300);

  } catch (err) {
    document.getElementById('scanStatus').textContent = '❌ Camera error: ' + err.message;
    document.getElementById('camOff').style.display = 'flex';
    console.error(err);
  }
}

function stopQRScan() {
  if (qrInterval)  { clearInterval(qrInterval); qrInterval = null; }
  if (qrStream)    { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
  document.getElementById('qrVideo').srcObject = null;
  document.getElementById('camOff').style.display = 'flex';
  document.getElementById('startScanBtn').style.display = '';
  document.getElementById('stopScanBtn').style.display  = 'none';
  document.getElementById('torchBtn').style.display     = 'none';
  document.getElementById('scanStatus').textContent = 'Camera stopped';
}

function toggleTorch() {
  if (!qrStream) return;
  const track = qrStream.getVideoTracks()[0];
  torchOn = !torchOn;
  try { track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch(e) {}
  document.getElementById('torchBtn').textContent = torchOn ? '🔦 Torch ON' : '🔦 Torch';
}

function processQRCode(data) {
  // Expected QR format: "ATTENDX:STU001:Rahul Sharma"
  if (!data.startsWith('ATTENDX:')) {
    showScanResult('QR code not recognized. Use AttendX QR codes only.', 'error');
    return;
  }

  const parts     = data.split(':');
  const studentId = parts[1];
  markAttendance(studentId, 'QR Code');
}

function markManual() {
  const id = document.getElementById('manualId').value.trim().toUpperCase();
  if (!id) return;
  markAttendance(id, 'Manual');
  document.getElementById('manualId').value = '';
}

// ═══════════════════════════════════════════════════════
//  MARK ATTENDANCE (core function)
// ═══════════════════════════════════════════════════════
function markAttendance(studentId, method) {
  const student = students.find(s => s.id === studentId);
  if (!student) {
    showScanResult(`❌ Student ID "${studentId}" not found in system.`, 'error');
    return;
  }

  const todayKey = new Date().toISOString().split('T')[0];
  const alreadyMarked = attendLogs.find(l => l.studentId === studentId && l.date === todayKey);

  if (alreadyMarked) {
    showScanResult(`⚠ ${student.name} already marked Present today at ${alreadyMarked.time}`, 'warn');
    return;
  }

  const now  = new Date();
  const time = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

  attendLogs.push({
    studentId: student.id,
    name:      student.name,
    cls:       student.cls,
    date:      todayKey,
    time,
    method,
    status:    'Present'
  });
  save();

  showScanResult(`✅ ${student.name} (${student.id}) — Present at ${time}`, 'success');
  renderTodayScans();
  renderDashboard();
}

function showScanResult(msg, type) {
  const card = document.getElementById('scanResultCard');
  const el   = document.getElementById('scanResult');
  card.style.display = 'block';
  el.className = 'scan-result ' + type;
  el.textContent = msg;
  setTimeout(() => { card.style.display = 'none'; }, 4000);
}

function renderTodayScans() {
  const todayKey  = new Date().toISOString().split('T')[0];
  const todayLogs = attendLogs.filter(l => l.date === todayKey).slice(-10).reverse();
  const el = document.getElementById('todayScans');
  if (!todayLogs.length) { el.innerHTML = '<div class="log-empty">No scans yet</div>'; return; }
  el.innerHTML = todayLogs.map(l => `
    <div class="log-item">
      <div class="log-dot p"></div>
      <div class="log-name">${l.name}</div>
      <span class="log-method">${l.method}</span>
      <div class="log-time">${l.time}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════
//  QR CODE GENERATION
// ═══════════════════════════════════════════════════════
function populateStudentDropdowns() {
  const dropdowns = ['qrStudentSel', 'faceStudentSel', 'reportStu'];
  dropdowns.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const isReport = id === 'reportStu';
    sel.innerHTML = isReport
      ? '<option value="all">All Students</option>'
      : '<option value="">-- Select Student --</option>';
    students.forEach(s => {
      sel.innerHTML += `<option value="${s.id}"${s.id===current?' selected':''}>${s.name} (${s.id})</option>`;
    });
  });
}

function generateSingleQR() {
  const sel = document.getElementById('qrStudentSel');
  const id  = sel.value;
  if (!id) { alert('Please select a student first'); return; }

  const student = students.find(s => s.id === id);
  const wrap    = document.getElementById('singleQRWrap');
  const qrDiv   = document.getElementById('singleQRCode');

  qrDiv.innerHTML = '';
  wrap.style.display = 'block';

  new QRCode(qrDiv, {
    text:          `ATTENDX:${student.id}:${student.name}`,
    width:         180,
    height:        180,
    colorDark:     '#000000',
    colorLight:    '#ffffff',
    correctLevel:  QRCode.CorrectLevel.H
  });

  document.getElementById('singleQRName').textContent = student.name;
  document.getElementById('singleQRId').textContent   = student.id + ' · ' + student.cls;
}

function generateAllQR() {
  const grid = document.getElementById('allQRGrid');
  grid.innerHTML = '';
  if (!students.length) { grid.innerHTML = '<p style="color:var(--muted);font-size:13px">No students added yet</p>'; return; }

  students.forEach(s => {
    const item = document.createElement('div');
    item.className = 'qr-item';

    const qrDiv = document.createElement('div');
    item.appendChild(qrDiv);

    new QRCode(qrDiv, {
      text:         `ATTENDX:${s.id}:${s.name}`,
      width:        120,
      height:       120,
      colorDark:    '#000000',
      colorLight:   '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    item.innerHTML += `
      <div class="qr-item-name">${s.name}</div>
      <div class="qr-item-id">${s.id}</div>`;
    grid.appendChild(item);
  });
}

function renderAllQRIfNeeded() {
  const grid = document.getElementById('allQRGrid');
  if (!grid.children.length) generateAllQR();
  populateStudentDropdowns();
}

function printQR() {
  window.print();
}

// ═══════════════════════════════════════════════════════
//  FACE DETECTION MODE
//  Uses camera + basic motion/face-presence detection
//  Student confirms their identity manually
// ═══════════════════════════════════════════════════════
async function startFaceMode() {
  try {
    const video   = document.getElementById('faceVideo');
    const canvas  = document.getElementById('faceCanvas');
    const ctx     = canvas.getContext('2d');

    document.getElementById('faceCamOff').style.display = 'none';
    document.getElementById('faceStatus').textContent = 'Starting camera…';

    faceStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = faceStream;
    await video.play();

    document.getElementById('startFaceBtn').style.display = 'none';
    document.getElementById('stopFaceBtn').style.display  = '';
    document.getElementById('faceStatus').textContent = '🟢 Camera active — look at the camera';

    canvas.style.position = 'absolute';
    canvas.style.top  = '0';
    canvas.style.left = '0';
    canvas.style.width  = '100%';
    canvas.style.height = '100%';

    let prevData = null;

    faceInterval = setInterval(() => {
      if (video.readyState < 2) return;

      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // ── Skin tone detection (basic face presence) ─────────────────────
      // Count pixels with skin-like RGB ranges
      let skinPixels = 0;
      const total = data.length / 4;

      for (let i = 0; i < data.length; i += 16) { // Sample every 4th pixel
        const r = data[i], g = data[i+1], b = data[i+2];
        // Skin tone heuristic: high red/green, lower blue, certain ratios
        if (
          r > 95 && g > 40 && b > 20 &&
          r > g && r > b &&
          Math.abs(r-g) > 15 &&
          r - Math.min(g,b) > 15 &&
          r < 250
        ) {
          skinPixels++;
        }
      }

      const skinRatio = skinPixels / (total / 4);

      // Motion detection with prev frame
      let motionScore = 0;
      if (prevData) {
        let diff = 0;
        for (let i = 0; i < data.length; i += 16) {
          diff += Math.abs(data[i] - prevData[i]);
        }
        motionScore = diff / (data.length / 16);
      }
      prevData = new Uint8ClampedArray(data);

      // Face "detected" if enough skin pixels AND some motion (live person)
      const hasFace = skinRatio > 0.04;

      const pill = document.getElementById('faceStatusPill');
      if (hasFace) {
        pill.textContent = '😊 Face Detected!';
        pill.classList.add('detected');
        faceDetected = true;
        document.getElementById('faceStatus').textContent = '✅ Face detected — select your name and confirm';
      } else {
        pill.textContent = 'No Face Detected';
        pill.classList.remove('detected');
        faceDetected = false;
        document.getElementById('faceStatus').textContent = '👀 Looking for face…';
      }

      // Draw face indicator rectangle on canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (hasFace) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth   = 3;
        ctx.strokeRect(canvas.width*0.2, canvas.height*0.1, canvas.width*0.6, canvas.height*0.75);
        ctx.fillStyle = 'rgba(34,197,94,0.08)';
        ctx.fillRect(canvas.width*0.2, canvas.height*0.1, canvas.width*0.6, canvas.height*0.75);
      }

    }, 200);

  } catch (err) {
    document.getElementById('faceStatus').textContent = '❌ Camera error: ' + err.message;
    document.getElementById('faceCamOff').style.display = 'flex';
    console.error(err);
  }
}

function stopFaceMode() {
  if (faceInterval) { clearInterval(faceInterval); faceInterval = null; }
  if (faceStream)   { faceStream.getTracks().forEach(t => t.stop()); faceStream = null; }
  document.getElementById('faceVideo').srcObject = null;
  const canvas = document.getElementById('faceCanvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('faceCamOff').style.display = 'flex';
  document.getElementById('startFaceBtn').style.display = '';
  document.getElementById('stopFaceBtn').style.display  = 'none';
  document.getElementById('faceStatus').textContent = 'Camera stopped';
  document.getElementById('faceStatusPill').textContent = 'No Face Detected';
  document.getElementById('faceStatusPill').classList.remove('detected');
  faceDetected = false;
}

function confirmFaceAttendance() {
  const sel = document.getElementById('faceStudentSel');
  const id  = sel.value;

  if (!id) { alert('Please select your name first'); return; }
  if (!faceStream) { alert('Please start the camera first'); return; }

  if (!faceDetected) {
    alert('No face detected. Please look directly at the camera and try again.');
    return;
  }

  const student = students.find(s => s.id === id);
  markAttendanceFace(student);
}

function markAttendanceFace(student) {
  const todayKey = new Date().toISOString().split('T')[0];
  const alreadyMarked = attendLogs.find(l => l.studentId === student.id && l.date === todayKey);

  const now  = new Date();
  const time = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

  const box  = document.getElementById('faceDetectedBox');
  const txt  = document.getElementById('faceDetectedText');
  box.style.display = 'block';

  if (alreadyMarked) {
    txt.textContent = `${student.name} already marked present at ${alreadyMarked.time}`;
    txt.style.color = 'var(--amber)';
    return;
  }

  attendLogs.push({
    studentId: student.id,
    name:      student.name,
    cls:       student.cls,
    date:      todayKey,
    time,
    method:    'Face Mode',
    status:    'Present'
  });
  save();

  txt.textContent = `✅ ${student.name} — Present marked at ${time}`;
  txt.style.color = 'var(--green)';

  renderFaceLog();
  renderDashboard();

  setTimeout(() => { box.style.display = 'none'; }, 4000);
}

function renderFaceLog() {
  const todayKey  = new Date().toISOString().split('T')[0];
  const faceLogs  = attendLogs.filter(l => l.date === todayKey && l.method === 'Face Mode').slice(-8).reverse();
  const el = document.getElementById('faceLog');
  if (!faceLogs.length) { el.innerHTML = '<div class="log-empty">No face confirmations yet</div>'; return; }
  el.innerHTML = faceLogs.map(l => `
    <div class="log-item">
      <div class="log-dot p"></div>
      <div class="log-name">${l.name}</div>
      <span class="log-method">Face</span>
      <div class="log-time">${l.time}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════
//  STUDENT MANAGEMENT
// ═══════════════════════════════════════════════════════
function addStudent() {
  const name  = document.getElementById('stuName').value.trim();
  const id    = document.getElementById('stuId').value.trim().toUpperCase();
  const cls   = document.getElementById('stuClass').value.trim();
  const roll  = document.getElementById('stuRoll').value.trim();
  const msgEl = document.getElementById('addStudentMsg');

  if (!name || !id) {
    msgEl.textContent = '❌ Name and Student ID are required';
    msgEl.style.color = 'var(--red)';
    msgEl.style.display = 'block';
    return;
  }

  if (students.find(s => s.id === id)) {
    msgEl.textContent = `❌ Student ID "${id}" already exists`;
    msgEl.style.color = 'var(--red)';
    msgEl.style.display = 'block';
    return;
  }

  students.push({ id, name, cls, roll });
  save();
  populateStudentDropdowns();
  renderStudentList();
  renderDashboard();

  // Clear form
  ['stuName','stuId','stuClass','stuRoll'].forEach(f => { document.getElementById(f).value = ''; });
  msgEl.textContent = `✅ ${name} added successfully!`;
  msgEl.style.color = 'var(--green)';
  msgEl.style.display = 'block';
  setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
}

function deleteStudent(id) {
  if (!confirm('Delete this student? Their attendance records will be kept.')) return;
  students = students.filter(s => s.id !== id);
  save();
  populateStudentDropdowns();
  renderStudentList();
  renderDashboard();
}

function renderStudentList() {
  const search = document.getElementById('stuSearch').value.toLowerCase();
  const el     = document.getElementById('studentList');
  const list   = students.filter(s =>
    s.name.toLowerCase().includes(search) ||
    s.id.toLowerCase().includes(search) ||
    s.cls.toLowerCase().includes(search)
  );

  if (!list.length) { el.innerHTML = '<div class="log-empty">No students found</div>'; return; }
  el.innerHTML = list.map(s => `
    <div class="student-item">
      <div class="student-avatar">${s.name.charAt(0).toUpperCase()}</div>
      <div class="student-info">
        <div class="student-name">${s.name}</div>
        <div class="student-meta">${s.id} · Roll: ${s.roll || 'N/A'}</div>
      </div>
      <span class="student-badge">${s.cls || 'No Class'}</span>
      <button class="del-btn" onclick="deleteStudent('${s.id}')" title="Delete">×</button>
    </div>`).join('');
}

// ── CSV Export (Students) ──────────────────────────────────────────────────────
function exportCSV() {
  const rows = [['Student ID','Name','Class','Roll']];
  students.forEach(s => rows.push([s.id, s.name, s.cls, s.roll]));
  downloadCSV(rows, 'students.csv');
}

// ═══════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════
function populateReportDropdown() {
  populateStudentDropdowns();
}

function renderReports() {
  const dateFilter = document.getElementById('reportDate').value;
  const stuFilter  = document.getElementById('reportStu').value;

  let logs = attendLogs;
  if (dateFilter) logs = logs.filter(l => l.date === dateFilter);
  if (stuFilter !== 'all') logs = logs.filter(l => l.studentId === stuFilter);

  // Summary stats
  const statsEl = document.getElementById('reportStats');
  const present = logs.length;
  const absent  = dateFilter
    ? students.filter(s => !logs.find(l => l.studentId === s.id)).length
    : 0;
  const pct = students.length > 0 ? Math.round((present / Math.max(students.length,1)) * 100) : 0;

  statsEl.innerHTML = `
    <div class="stat-card s-green"><div class="stat-icon">✅</div><div class="stat-num">${present}</div><div class="stat-label">Records Found</div></div>
    ${dateFilter ? `
    <div class="stat-card s-red"><div class="stat-icon">❌</div><div class="stat-num">${absent}</div><div class="stat-label">Absent</div></div>
    <div class="stat-card s-amber"><div class="stat-icon">📊</div><div class="stat-num">${pct}%</div><div class="stat-label">Rate</div></div>
    ` : ''}
    <div class="stat-card s-blue"><div class="stat-icon">📅</div><div class="stat-num">${[...new Set(attendLogs.map(l=>l.date))].length}</div><div class="stat-label">Total Days</div></div>
  `;

  // Table
  const tbody = document.getElementById('reportBody');
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:2rem">No records found for selected filters</td></tr>';
    return;
  }
  tbody.innerHTML = logs.slice().reverse().map((l, i) => `
    <tr>
      <td style="color:var(--muted)">${i+1}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${l.studentId}</td>
      <td style="font-weight:500">${l.name}</td>
      <td style="color:var(--muted)">${l.cls || '—'}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${l.date}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${l.time}</td>
      <td><span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--blue-dim);color:var(--blue)">${l.method}</span></td>
      <td><span class="badge-p">Present</span></td>
    </tr>`).join('');
}

function exportReportCSV() {
  const dateFilter = document.getElementById('reportDate').value;
  const stuFilter  = document.getElementById('reportStu').value;

  let logs = attendLogs;
  if (dateFilter) logs = logs.filter(l => l.date === dateFilter);
  if (stuFilter !== 'all') logs = logs.filter(l => l.studentId === stuFilter);

  const rows = [['Student ID','Name','Class','Date','Time','Method','Status']];
  logs.forEach(l => rows.push([l.studentId, l.name, l.cls||'', l.date, l.time, l.method, 'Present']));

  // Also add absent rows if date filtered
  if (dateFilter && stuFilter === 'all') {
    const presentIds = new Set(logs.map(l => l.studentId));
    students.filter(s => !presentIds.has(s.id)).forEach(s =>
      rows.push([s.id, s.name, s.cls||'', dateFilter, '—', '—', 'Absent'])
    );
  }

  downloadCSV(rows, `attendance_${dateFilter || 'all'}.csv`);
}

function clearAllLogs() {
  if (!confirm('Clear ALL attendance logs? This cannot be undone!')) return;
  attendLogs = [];
  save();
  renderReports();
  renderDashboard();
}

// ── CSV helper ─────────────────────────────────────────────────────────────────
function downloadCSV(rows, filename) {
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
renderDashboard();
renderStudentList();
renderTodayScans();
populateStudentDropdowns();
