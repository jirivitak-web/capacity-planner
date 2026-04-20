let state = {
    people: [],
    projects: [],
    assignments: [] // Nyní bude: { week, personId, projectId, percentage }
};

let currentFilterPeople = 'all';
let currentFilterProjects = 'active';
let currentFilterProjectPM = 'all';
let showInactivePeople = false;

let weeks = [];
let currentWeek = '';
let selectedPersonIdForAssign = null;

// --- INITIALIZATION ---
function init() {
    generateWeeks();
    setCurrentWeek();
    setupEventListeners();

    const status = document.getElementById('last-saved');
    status.textContent = 'Načítám z cloudu...';

    db.ref('state').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state = {
                people: data.people || [],
                projects: data.projects || [],
                assignments: data.assignments || []
            };
        } else {
            state = { ...INITIAL_DATA };
            saveState(); // Vložíme výchozí data do Firebase
        }
        
        renderWeekSelector();
        updatePMFilterDropdown();
        renderPeople();
        renderProjects();
        status.textContent = 'Data načtena: ' + new Date().toLocaleTimeString();
    });
}

function updatePMFilterDropdown() {
    const select = document.getElementById('project-pm-filter');
    if (!select) return;
    const currentVal = select.value || 'all';
    select.innerHTML = '<option value="all">Všichni PM</option><option value="none">Bez PM</option>';
    
    state.people.filter(p => p.group === 'pm').forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.fullName} (${p.initials})</option>`;
    });
    
    select.value = currentVal;
}

function saveState() {
    const status = document.getElementById('last-saved');
    status.textContent = 'Ukládám do cloudu...';
    
    db.ref('state').set(state, (error) => {
        if (error) {
            status.textContent = 'Chyba ukládání!';
            console.error('Data could not be saved.', error);
        } else {
            status.textContent = 'Uloženo (Cloud): ' + new Date().toLocaleTimeString();
            updatePMFilterDropdown();
        }
    });
}

// --- WEEKS LOGIC ---
function generateWeeks() {
    // Připravíme týdny pro rok 2026 (1 až 53)
    for (let i = 1; i <= 53; i++) {
        weeks.push(`2026-W${i.toString().padStart(2, '0')}`);
    }
}

function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}

function getWeekDateRange(year, week) {
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay() || 7;
    const week1Monday = new Date(year, 0, 4 - day + 1);
    const targetMonday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
    const targetSunday = new Date(targetMonday.getTime() + 6 * 86400000);
    const format = d => `${d.getDate()}.${d.getMonth() + 1}.`;
    return `${format(targetMonday)} - ${format(targetSunday)}`;
}

function setCurrentWeek() {
    const now = new Date();
    // Pro ukázku zafixujeme rok 2026, jak bylo v zadání. 
    // Pokud by byl jiný rok, fallbackneme na první týden 2026.
    const year = now.getFullYear();
    const weekNum = getISOWeek(now);
    
    currentWeek = `2026-W${weekNum.toString().padStart(2, '0')}`;
    if (!weeks.includes(currentWeek)) currentWeek = weeks[0];
}

function renderWeekSelector() {
    const select = document.getElementById('week-dropdown');
    select.innerHTML = '';
    weeks.forEach(w => {
        const option = document.createElement('option');
        option.value = w;
        const weekNum = parseInt(w.split('-W')[1]);
        option.textContent = `Týden ${weekNum} (2026)`;
        if (w === currentWeek) option.selected = true;
        select.appendChild(option);
    });
    updateWeekDateLabel();
}

function updateWeekDateLabel() {
    if (!currentWeek) return;
    const [yearStr, weekStr] = currentWeek.split('-W');
    const range = getWeekDateRange(parseInt(yearStr), parseInt(weekStr));
    document.getElementById('week-date-range').textContent = range;
}

// --- RENDERING ---

function renderPeople() {
    const list = document.getElementById('people-list');
    list.innerHTML = '';

    const filteredPeople = state.people.filter(p => {
        let matchesGroup = false;
        if (currentFilterPeople === 'all') {
            matchesGroup = p.group !== 'pm';
        } else {
            matchesGroup = p.group === currentFilterPeople;
        }
        const matchesActive = showInactivePeople || p.active;
        return matchesGroup && matchesActive;
    });

    filteredPeople.forEach(person => {
        const isPM = person.group === 'pm';
        const totalPct = calculateUtilization(person.id, currentWeek);
        
        const card = document.createElement('div');
        card.className = `person-card ${!person.active ? 'inactive' : ''}`;
        
        if (!isPM && person.active) {
            card.setAttribute('draggable', 'true');
            card.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', person.id);
                e.dataTransfer.effectAllowed = 'copy';
                card.classList.add('dragging');
            };
            card.ondragend = () => {
                card.classList.remove('dragging');
            };
        }

        let utilHTML = '';
        let progressHTML = '';

        if (!isPM) {
            let textColorClass = 'util-text-ok';
            let barColorClass = 'fill-ok';
            
            if (totalPct === person.maxCapacity) {
                textColorClass = 'util-text-full';
                barColorClass = 'fill-full';
            } else if (totalPct > person.maxCapacity) {
                textColorClass = 'util-text-over';
                barColorClass = 'fill-over';
            } else if (totalPct === 0) {
                textColorClass = 'util-text-low';
                barColorClass = 'fill-low';
            }

            utilHTML = `<div class="util-pct ${textColorClass}">${totalPct}%</div>`;
            progressHTML = `
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill ${barColorClass}" style="width: ${Math.min((totalPct / person.maxCapacity) * 100, 100)}%;"></div>
                </div>
            `;
        } else {
            utilHTML = `<div class="util-pct util-text-low" style="font-size: 0.7rem; font-weight: 600;"><i class="fas fa-user-tie"></i> MANAŽER</div>`;
        }

        card.innerHTML = `
            <div class="card-actions">
                <button class="edit-btn" onclick="openEditPerson('${person.id}')"><i class="fas fa-pencil"></i></button>
            </div>
            <div class="person-info-compact">
                <div class="person-name-compact">${person.fullName} <span class="person-initials">(${person.initials})</span></div>
                ${utilHTML}
            </div>
            ${progressHTML}
        `;
        list.appendChild(card);
    });
}

function renderProjects() {
    const list = document.getElementById('projects-list');
    list.innerHTML = '';

    const filteredProjects = state.projects.filter(p => {
        const matchesStatus = currentFilterProjects === 'all' || p.status === currentFilterProjects;
        const matchesPM = currentFilterProjectPM === 'all' || 
                          (currentFilterProjectPM === 'none' && !p.pmId) || 
                          (p.pmId === currentFilterProjectPM);
        return matchesStatus && matchesPM;
    });

    filteredProjects.forEach(project => {
        // Zde filtrujeme přiřazení POUZE pro aktuální týden
        const assignments = state.assignments.filter(a => a.projectId === project.id && a.week === currentWeek);
        
        const card = document.createElement('div');
        card.className = `project-card ${project.status}`;
        
        if (project.status === 'active') {
            card.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                card.classList.add('drag-over');
            };
            card.ondragleave = () => {
                card.classList.remove('drag-over');
            };
            card.ondrop = (e) => {
                e.preventDefault();
                card.classList.remove('drag-over');
                const personId = e.dataTransfer.getData('text/plain');
                if (personId) {
                    openAssignModal(project.id, project.name, personId);
                }
            };
        }

        const pm = project.pmId ? state.people.find(p => p.id === project.pmId) : null;
        const pmText = pm ? `${pm.fullName} (${pm.initials})` : 'Nepřiřazen';
        
        let lightClass = 'light-active';
        if (project.status === 'paused') lightClass = 'light-paused';
        if (project.status === 'finished') lightClass = 'light-finished';

        card.innerHTML = `
            <div class="card-actions">
                <button class="edit-btn" onclick="openEditProject('${project.id}')"><i class="fas fa-pencil"></i></button>
            </div>
            <div class="project-header-top">
                <div class="project-title-wrapper">
                    <div class="project-title">
                        <span class="status-light ${lightClass}" title="${project.status}"></span>
                        ${project.name}
                    </div>
                </div>
            </div>
            <div class="assignments-grid">
                ${assignments.map(a => {
                    const person = state.people.find(p => p.id === a.personId);
                    return `
                        <div class="assignment-item">
                            <span class="assign-name">${person ? person.initials : '???'}</span>
                            <span class="assign-pct">${a.percentage}%</span>
                            <button class="remove-assign" onclick="removeAssignment('${a.personId}', '${a.projectId}', ${a.percentage})"><i class="fas fa-times"></i></button>
                        </div>
                    `;
                }).join('')}
                <button class="add-assign-btn" onclick="openAssignModal('${project.id}', '${project.name}')">
                    + Přiřadit
                </button>
            </div>
            <div class="project-pm"><i class="fas fa-user-tie"></i> ${pmText}</div>
        `;
        list.appendChild(card);
    });
}

// --- LOGIC ---

function calculateUtilization(personId, week) {
    return state.assignments
        .filter(a => a.personId === personId && a.week === week)
        .reduce((sum, a) => sum + a.percentage, 0);
}

// --- MODALS & SEARCH ---

function openAssignModal(projectId, projectName, prefillPersonId = null) {
    const modal = document.getElementById('assign-modal');
    document.getElementById('modal-project-name').textContent = projectName;
    document.getElementById('person-search').value = '';
    
    selectedPersonIdForAssign = null;
    document.getElementById('confirm-assign').disabled = true;
    
    renderCustomPersonSelect('');

    if (prefillPersonId) {
        selectedPersonIdForAssign = prefillPersonId;
        document.getElementById('confirm-assign').disabled = false;
        
        const person = state.people.find(p => p.id === prefillPersonId);
        if (person) {
            document.getElementById('person-search').value = `${person.fullName} (${person.initials})`;
            renderCustomPersonSelect(''); // aktualizace pro zvýraznění
        }
        
        setTimeout(() => {
            const select = document.getElementById('capacity-select');
            if (select) select.focus();
        }, 50);
    }
    
    modal.dataset.currentProjectId = projectId;
    modal.style.display = 'block';
}

function renderCustomPersonSelect(search) {
    const list = document.getElementById('person-select-list');
    list.innerHTML = '';
    
    const term = search.toLowerCase();
    const filtered = state.people
        .filter(p => p.active && p.group !== 'pm' && (p.fullName.toLowerCase().includes(term) || p.initials.toLowerCase().includes(term)))
        .sort((a,b) => a.fullName.localeCompare(b.fullName));

    filtered.forEach(person => {
        const currentUtil = calculateUtilization(person.id, currentWeek);
        const div = document.createElement('div');
        
        let statusClass = 'status-ok';
        if (currentUtil === person.maxCapacity) statusClass = 'status-full';
        if (currentUtil > person.maxCapacity) statusClass = 'status-over';

        div.className = `person-option ${statusClass} ${person.id === selectedPersonIdForAssign ? 'selected' : ''}`;
        div.innerHTML = `
            <span>${person.fullName} (${person.initials})</span>
            <span class="opt-pct">${currentUtil}% / ${person.maxCapacity}%</span>
        `;
        
        div.onclick = () => {
            selectedPersonIdForAssign = person.id;
            document.getElementById('confirm-assign').disabled = false;
            renderCustomPersonSelect(search); // re-render to update 'selected' class
        };
        
        list.appendChild(div);
    });
}

// --- EDITING ---

function openEditPerson(id) {
    const person = state.people.find(p => p.id === id);
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').textContent = 'Editace člověka';
    document.getElementById('edit-person-fields').style.display = 'block';
    document.getElementById('edit-project-fields').style.display = 'none';
    
    document.getElementById('edit-full-name').value = person.fullName;
    document.getElementById('edit-initials').value = person.initials;
    document.getElementById('edit-group').value = person.group;
    document.getElementById('edit-max-cap').value = person.maxCapacity;
    document.getElementById('edit-person-active').checked = person.active;
    
    modal.dataset.editId = id;
    modal.dataset.editType = 'person';
    modal.style.display = 'block';
}

function openEditProject(id) {
    const project = state.projects.find(p => p.id === id);
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').textContent = 'Editace projektu';
    document.getElementById('edit-person-fields').style.display = 'none';
    document.getElementById('edit-project-fields').style.display = 'block';
    
    document.getElementById('edit-project-name').value = project.name;
    document.getElementById('edit-project-status').value = project.status;
    
    const pmSelect = document.getElementById('edit-project-pm');
    pmSelect.innerHTML = '<option value="">-- Bez PM --</option>';
    state.people.filter(p => p.active && p.group === 'pm').forEach(p => {
        pmSelect.innerHTML += `<option value="${p.id}">${p.fullName} (${p.initials})</option>`;
    });
    pmSelect.value = project.pmId || '';
    
    modal.dataset.editId = id;
    modal.dataset.editType = 'project';
    modal.style.display = 'block';
}

function removeAssignment(personId, projectId, percentage) {
    state.assignments = state.assignments.filter(a => 
        !(a.personId === personId && a.projectId === projectId && a.percentage === percentage && a.week === currentWeek)
    );
    saveState();
    renderPeople();
    renderProjects();
}

// --- EVENT LISTENERS ---

function setupEventListeners() {
    // Week navigation
    document.getElementById('week-dropdown').onchange = (e) => {
        currentWeek = e.target.value;
        updateWeekDateLabel();
        renderPeople();
        renderProjects();
    };
    
    document.getElementById('prev-week').onclick = () => {
        const idx = weeks.indexOf(currentWeek);
        if (idx > 0) {
            currentWeek = weeks[idx - 1];
            document.getElementById('week-dropdown').value = currentWeek;
            updateWeekDateLabel();
            renderPeople();
            renderProjects();
        }
    };

    document.getElementById('next-week').onclick = () => {
        const idx = weeks.indexOf(currentWeek);
        if (idx < weeks.length - 1) {
            currentWeek = weeks[idx + 1];
            document.getElementById('week-dropdown').value = currentWeek;
            updateWeekDateLabel();
            renderPeople();
            renderProjects();
        }
    };

    // Modal close
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => {
            document.getElementById('assign-modal').style.display = 'none';
            document.getElementById('edit-modal').style.display = 'none';
        };
    });

    // Search in assignment modal
    document.getElementById('person-search').oninput = (e) => {
        renderCustomPersonSelect(e.target.value);
    };

    // Confirm assignment
    document.getElementById('confirm-assign').onclick = () => {
        const modal = document.getElementById('assign-modal');
        const projectId = modal.dataset.currentProjectId;
        const percentage = parseInt(document.getElementById('capacity-select').value);

        if (!selectedPersonIdForAssign) return;

        state.assignments.push({ 
            week: currentWeek, 
            personId: selectedPersonIdForAssign, 
            projectId, 
            percentage 
        });
        
        saveState();
        renderPeople();
        renderProjects();
        modal.style.display = 'none';
    };

    // Save Edit
    document.getElementById('save-edit').onclick = () => {
        const modal = document.getElementById('edit-modal');
        const id = modal.dataset.editId;
        const type = modal.dataset.editType;

        if (type === 'person') {
            const idx = state.people.findIndex(p => p.id === id);
            state.people[idx] = {
                ...state.people[idx],
                fullName: document.getElementById('edit-full-name').value,
                initials: document.getElementById('edit-initials').value,
                group: document.getElementById('edit-group').value,
                maxCapacity: parseInt(document.getElementById('edit-max-cap').value),
                active: document.getElementById('edit-person-active').checked
            };
        } else {
            const idx = state.projects.findIndex(p => p.id === id);
            state.projects[idx] = {
                ...state.projects[idx],
                name: document.getElementById('edit-project-name').value,
                status: document.getElementById('edit-project-status').value,
                pmId: document.getElementById('edit-project-pm').value
            };
        }

        saveState();
        renderPeople();
        renderProjects();
        modal.style.display = 'none';
    };

    // Delete Entry
    document.getElementById('delete-entry').onclick = () => {
        const modal = document.getElementById('edit-modal');
        const id = modal.dataset.editId;
        const type = modal.dataset.editType;

        if (confirm('Opravdu chcete tuto položku smazat?')) {
            if (type === 'person') {
                state.people = state.people.filter(p => p.id !== id);
                state.assignments = state.assignments.filter(a => a.personId !== id);
            } else {
                state.projects = state.projects.filter(p => p.id !== id);
                state.assignments = state.assignments.filter(a => a.projectId !== id);
            }
            saveState();
            renderPeople();
            renderProjects();
            modal.style.display = 'none';
        }
    };

    // Add Person
    document.getElementById('add-person-btn').onclick = () => {
        const id = 'p_' + Date.now();
        state.people.push({ id, initials: '???', fullName: 'Nový člověk', group: 'dev', maxCapacity: 100, active: true });
        openEditPerson(id);
    };

    // Add Project
    document.getElementById('add-project-btn').onclick = () => {
        const id = 'pr_' + Date.now();
        state.projects.push({ id, name: 'Nový projekt', status: 'active', pmId: '' });
        openEditProject(id);
    };

    // Filters
    document.querySelectorAll('.people-panel .filter-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.people-panel .filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilterPeople = e.target.dataset.group;
            renderPeople();
        };
    });

    document.querySelectorAll('#project-status-filters .filter-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('#project-status-filters .filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilterProjects = e.target.dataset.status;
            renderProjects();
        };
    });

    document.getElementById('project-pm-filter').onchange = (e) => {
        currentFilterProjectPM = e.target.value;
        renderProjects();
    };

    document.getElementById('show-inactive-people').onchange = (e) => {
        showInactivePeople = e.target.checked;
        renderPeople();
    };

    // Reset
    document.getElementById('reset-data').onclick = () => {
        if (confirm('Smazat vše a začít znovu?')) {
            localStorage.removeItem('capacity_planner_state_v3');
            location.reload();
        }
    };

    // CSV
    document.getElementById('export-csv-btn').onclick = exportToCSV;
    document.getElementById('import-csv-btn').onclick = () => document.getElementById('csv-file-input').click();
    document.getElementById('csv-file-input').onchange = importFromCSV;
}

// --- CSV HANDLERS ---
function exportToCSV() {
    let peopleCsv = "id;initials;fullName;group;maxCapacity;active\n";
    state.people.forEach(p => peopleCsv += `${p.id};${p.initials};${p.fullName};${p.group};${p.maxCapacity};${p.active}\n`);
    downloadCSV(peopleCsv, "people.csv");

    let projectsCsv = "id;name;status;pmId\n";
    state.projects.forEach(p => projectsCsv += `${p.id};${p.name};${p.status};${p.pmId || ''}\n`);
    downloadCSV(projectsCsv, "projects.csv");

    let assignmentsCsv = "week;personId;projectId;percentage\n";
    state.assignments.forEach(a => assignmentsCsv += `${a.week};${a.personId};${a.projectId};${a.percentage}\n`);
    downloadCSV(assignmentsCsv, "assignments.csv");
}

function downloadCSV(csv, filename) {
    // \uFEFF je BOM (Byte Order Mark) - říká Excelu, že to je nativně UTF-8
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function importFromCSV(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    let newPeople = state.people;
    let newProjects = state.projects;
    let newAssignments = state.assignments;
    
    let processedFiles = 0;

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(event) {
            const lines = event.target.result.split('\n');
            const header = lines[0].trim();
            
            const parsedData = [];
            for(let i=1; i<lines.length; i++) {
                const line = lines[i].trim();
                if(!line) continue;
                parsedData.push(line.split(';'));
            }

            if (header.includes('maxCapacity')) {
                newPeople = parsedData.map(c => ({ id: c[0], initials: c[1], fullName: c[2], group: c[3], maxCapacity: parseInt(c[4]), active: c[5] === 'true' }));
            } else if (header.includes('pmId')) {
                newProjects = parsedData.map(c => ({ id: c[0], name: c[1], status: c[2], pmId: c[3] || '' }));
            } else if (header.includes('percentage')) {
                newAssignments = parsedData.map(c => ({ week: c[0], personId: c[1], projectId: c[2], percentage: parseInt(c[3]) }));
            }
            
            processedFiles++;
            if (processedFiles === files.length) {
                if (confirm('Importovat data z vybraných souborů? Stávající data budou nahrazena.')) {
                    state = { people: newPeople, projects: newProjects, assignments: newAssignments };
                    saveState();
                    location.reload();
                }
            }
        };
        reader.readAsText(file, "UTF-8");
    });
}

document.getElementById('login-btn').onclick = () => {
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    
    if (user === 'bootiq' && pass === 'pmplzen') {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-wrapper').style.display = 'flex';
        init();
    } else {
        document.getElementById('login-error').style.display = 'block';
    }
};

document.getElementById('login-pass').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
});
