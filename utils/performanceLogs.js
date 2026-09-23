const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, '..', 'performance_logs.json');
const inviteStatePath = path.join(__dirname, '..', 'invite_logs.json');

function normalizeState(state) {
    const instructors = Array.isArray(state?.instructors) ? state.instructors : [];
    const instructorNames = new Set(instructors.map(instructor => normalizeName(instructor)));

    return {
        instructors,
        events: (Array.isArray(state?.events) ? state.events : [])
            .filter(event => event?.instructor && instructorNames.has(normalizeName(event.instructor)))
    };
}

function readPerformanceState() {
    if (!fs.existsSync(statePath)) {
        return { instructors: [], events: [] };
    }

    try {
        const state = normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
        writePerformanceState(state);
        return state;
    } catch (error) {
        console.error('Failed to read performance log state:', error.message);
        return { instructors: [], events: [] };
    }
}

function writePerformanceState(state) {
    fs.writeFileSync(statePath, JSON.stringify(normalizeState(state), null, 2));
}

function normalizeName(name) {
    return name.trim().toLowerCase();
}

function getInstructor(name, state = readPerformanceState()) {
    const normalizedName = normalizeName(name);
    return state.instructors.find(instructor => normalizeName(instructor) === normalizedName) || null;
}

function addInstructor(name) {
    const state = readPerformanceState();
    const instructorName = name.trim();

    if (!instructorName) {
        return { added: false, state };
    }

    if (getInstructor(instructorName, state)) {
        return { added: false, state };
    }

    state.instructors.push(instructorName);
    state.instructors.sort((left, right) => left.localeCompare(right));
    writePerformanceState(state);
    const imported = syncInviteRecordsFromDatabase(state);
    state.events = imported.state.events;
    return { added: true, state };
}

function removeInstructor(name) {
    const state = readPerformanceState();
    const normalizedName = normalizeName(name);
    const index = state.instructors.findIndex(instructor => normalizeName(instructor) === normalizedName);

    if (index === -1) {
        return { removed: false, state };
    }

    state.instructors.splice(index, 1);
    const remainingInstructors = new Set(state.instructors.map(instructor => normalizeName(instructor)));
    state.events = state.events.filter(
        event => remainingInstructors.has(normalizeName(event.instructor))
    );
    writePerformanceState(state);
    return { removed: true, state };
}

function recordEvent(event) {
    const state = readPerformanceState();
    if (!getInstructor(event.instructor, state)) {
        return;
    }

    state.events.push({
        ...event,
        recordedAt: new Date().toISOString()
    });
    writePerformanceState(state);
}

function recordInvite(entry) {
    if (!entry?.messageId || !entry?.invitedBy || !entry?.name) {
        return;
    }

    const state = readPerformanceState();
    if (!getInstructor(entry.invitedBy, state)) {
        return;
    }

    const eventId = `invite:${entry.messageId}`;
    if (state.events.some(event => event.id === eventId)) {
        return;
    }

    recordEvent({
        id: eventId,
        type: 'invite',
        instructor: entry.invitedBy.trim(),
        cadet: entry.name,
        date: entry.date
    });
}

function recordCto(entry, instructor, result) {
    if (!entry?.messageId || !instructor?.trim() || !result) {
        return;
    }

    const state = readPerformanceState();
    if (!getInstructor(instructor, state)) {
        return;
    }

    recordEvent({
        id: `cto:${entry.messageId}:${Date.now()}`,
        type: 'cto',
        instructor: instructor.trim(),
        cadet: entry.name,
        result,
        date: new Date().toISOString().slice(0, 10)
    });
}

function syncInviteRecords(entries) {
    const state = readPerformanceState();
    const existingIds = new Set(state.events.map(event => event.id));
    let changed = false;

    for (const entry of entries) {
        if (!entry?.messageId || !entry?.invitedBy || !entry?.name || !getInstructor(entry.invitedBy, state)) {
            continue;
        }

        const eventId = `invite:${entry.messageId}`;
        if (existingIds.has(eventId)) {
            continue;
        }

        state.events.push({
            id: eventId,
            type: 'invite',
            instructor: entry.invitedBy.trim(),
            cadet: entry.name,
            date: entry.date,
            recordedAt: new Date().toISOString()
        });
        existingIds.add(eventId);
        changed = true;
    }

    if (changed) {
        writePerformanceState(state);
    }

    return state;
}

function syncInviteRecordsFromDatabase(currentState = readPerformanceState()) {
    if (!fs.existsSync(inviteStatePath)) {
        return { state: currentState, imported: 0 };
    }

    try {
        const inviteState = JSON.parse(fs.readFileSync(inviteStatePath, 'utf8'));
        const entries = Object.values(inviteState?.processed || {});
        const before = currentState.events.length;
        const state = syncInviteRecords(entries);
        return { state, imported: state.events.length - before };
    } catch (error) {
        console.error('Failed to import invite performance records:', error.message);
        return { state: currentState, imported: 0 };
    }
}

function getInstructorChoices(value = '') {
    const search = value.toLowerCase();
    return readPerformanceState().instructors
        .filter(instructor => instructor.toLowerCase().includes(search))
        .slice(0, 25)
        .map(instructor => ({ name: instructor, value: instructor }));
}

module.exports = {
    addInstructor,
    getInstructor,
    getInstructorChoices,
    readPerformanceState,
    recordCto,
    recordInvite,
    removeInstructor,
    syncInviteRecords,
    syncInviteRecordsFromDatabase
};
