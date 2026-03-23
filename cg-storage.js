/*\
title: $:/plugins/rimir/minver/cg-storage.js
type: application/javascript
module-type: library
\*/
"use strict";

var storage = require("$:/plugins/rimir/minver/storage.js");

var CG_STORAGE_PREFIX = "minver-cg:";
var CG_INDEX_KEY = "minver-cg-index";
var TEMP_INDEX = "$:/temp/minver/change-groups";
var TEMP_RECORDING = "$:/temp/minver/cg-recording";
var TEMP_ACTIVE_GROUP = "$:/temp/minver/cg-active-group";

// --- Module-level state for active recording ---

var activeGroup = null;
// Lookup map: title → index in activeGroup.operations (for coalescing)
var opIndex = {};

// --- State accessors ---

function isRecording() {
	return activeGroup !== null;
}

function getActiveGroup() {
	return activeGroup;
}

// --- Recording lifecycle ---

function startRecording(wiki, label) {
	if (activeGroup) {
		console.warn("minver-cg: recording already active, stopping previous");
		stopRecording(wiki);
	}
	var id = storage.generateId();
	activeGroup = {
		id: id,
		label: label || "recording-" + $tw.utils.stringifyDate(new Date()),
		startTime: Date.now(),
		endTime: null,
		operations: []
	};
	opIndex = {};
	wiki.addTiddler(new $tw.Tiddler({
		title: TEMP_RECORDING,
		text: id
	}));
	// Write active group to temp for live UI
	updateActiveGroupTiddler(wiki);
	console.log("minver-cg: started recording", id, label);
	return id;
}

function stopRecording(wiki) {
	if (!activeGroup) {
		console.warn("minver-cg: no active recording to stop");
		return Promise.resolve();
	}
	activeGroup.endTime = Date.now();
	// Clean up no-op modifications (before === after)
	cleanNoOps();
	var group = activeGroup;
	activeGroup = null;
	opIndex = {};
	wiki.deleteTiddler(TEMP_RECORDING);
	wiki.deleteTiddler(TEMP_ACTIVE_GROUP);
	// If no operations, skip saving
	if (group.operations.length === 0) {
		console.log("minver-cg: recording stopped with no changes, not saving");
		return Promise.resolve();
	}
	// Persist to localStorage and update index
	return saveGroup(group).then(function() {
		return loadIndex();
	}).then(function(index) {
		index.push({
			id: group.id,
			label: group.label,
			startTime: group.startTime,
			endTime: group.endTime,
			opCount: group.operations.length
		});
		// Evict oldest if over limit
		var max = getMaxGroups(wiki);
		index = evictGroups(index, max);
		return saveIndex(index);
	}).then(function() {
		return hydrateIndex(wiki);
	}).then(function() {
		console.log("minver-cg: recording stopped and saved", group.id, "(" + group.operations.length + " ops)");
	});
}

// --- Hook callbacks (coalescing logic) ---

function recordSave(wiki, title, beforeFields, afterFields) {
	if (!activeGroup) return;
	var existingIdx = opIndex[title];
	if (existingIdx !== undefined) {
		// Tiddler already in this recording — coalesce
		var existing = activeGroup.operations[existingIdx];
		existing.after = afterFields;
		existing.timestamp = Date.now();
	} else {
		// New operation
		var type = beforeFields ? "modify" : "create";
		var op = {
			id: storage.generateId(),
			timestamp: Date.now(),
			type: type,
			title: title,
			before: beforeFields || null,
			after: afterFields
		};
		opIndex[title] = activeGroup.operations.length;
		activeGroup.operations.push(op);
	}
	updateActiveGroupTiddler(wiki);
}

function recordDelete(wiki, title, deletedFields) {
	if (!activeGroup) return;
	var existingIdx = opIndex[title];
	if (existingIdx !== undefined) {
		var existing = activeGroup.operations[existingIdx];
		if (existing.type === "create") {
			// Created then deleted during same session → net zero, remove op
			activeGroup.operations.splice(existingIdx, 1);
			delete opIndex[title];
			// Rebuild opIndex after splice
			rebuildOpIndex();
		} else {
			// Modified then deleted → change to delete, keep original before
			existing.type = "delete";
			existing.after = null;
			existing.timestamp = Date.now();
		}
	} else {
		// New delete operation
		var op = {
			id: storage.generateId(),
			timestamp: Date.now(),
			type: "delete",
			title: title,
			before: deletedFields || null,
			after: null
		};
		opIndex[title] = activeGroup.operations.length;
		activeGroup.operations.push(op);
	}
	updateActiveGroupTiddler(wiki);
}

// --- Coalescing helpers ---

function rebuildOpIndex() {
	opIndex = {};
	if (!activeGroup) return;
	for (var i = 0; i < activeGroup.operations.length; i++) {
		opIndex[activeGroup.operations[i].title] = i;
	}
}

function cleanNoOps() {
	if (!activeGroup) return;
	// Remove modify ops where before === after (no net change)
	activeGroup.operations = activeGroup.operations.filter(function(op) {
		if (op.type !== "modify") return true;
		return !fieldsEqual(op.before, op.after);
	});
}

var fieldsEqual = storage.fieldsEqual;

// --- Rollback ---

function rollbackGroup(wiki, group) {
	var label = "pre-rollback-" + $tw.utils.stringifyDate(new Date());
	// Process operations in reverse order
	for (var i = group.operations.length - 1; i >= 0; i--) {
		var op = group.operations[i];
		if (op.type === "create") {
			// Undo creation: delete tiddler and clean up all its snapshots
			wiki.deleteTiddler(op.title);
			storage.saveSnapshotsToStore(wiki, op.title, []);
			storage.saveToLocalStorage(op.title, []);
		} else if (op.type === "modify") {
			// Snapshot the current (modified) state before restoring
			snapshotBeforeRollback(wiki, op.title, label);
			// Remove auto-snapshots created during the recording period
			removeAutoSnapshotsInRange(wiki, op.title, group.startTime, group.endTime);
			// Restore to before state
			if (op.before) {
				wiki.addTiddler(new $tw.Tiddler(op.before));
			}
		} else if (op.type === "delete") {
			// Tiddler doesn't exist (was deleted) — recreate from before state
			if (op.before) {
				wiki.addTiddler(new $tw.Tiddler(op.before));
			}
		}
	}
}

function snapshotBeforeRollback(wiki, title, label) {
	var currentFields = storage.captureTiddlerFields(wiki, title, false);
	if (!currentFields) return;
	var snapshot = storage.createSnapshot("auto", label, currentFields);
	var snapshots = storage.getSnapshotsFromStore(wiki, title);
	snapshots.push(snapshot);
	snapshots = storage.evict(snapshots, storage.getMaxManual(wiki), storage.getMaxAuto(wiki));
	storage.saveSnapshotsToStore(wiki, title, snapshots);
	storage.saveToLocalStorage(title, snapshots);
}

function removeAutoSnapshotsInRange(wiki, title, startTime, endTime) {
	var snapshots = storage.getSnapshotsFromStore(wiki, title);
	snapshots = snapshots.filter(function(s) {
		// Keep manual snapshots and auto-snapshots outside the recording window
		if (s.type !== "auto") return true;
		return s.timestamp < startTime || s.timestamp > endTime;
	});
	storage.saveSnapshotsToStore(wiki, title, snapshots);
	storage.saveToLocalStorage(title, snapshots);
}

// --- Temp tiddler helpers ---

function updateActiveGroupTiddler(wiki) {
	if (!activeGroup) return;
	wiki.addTiddler(new $tw.Tiddler({
		title: TEMP_ACTIVE_GROUP,
		text: JSON.stringify(activeGroup),
		type: "application/json"
	}));
}

// --- localStorage persistence (compressed) ---

function saveGroup(group) {
	var key = CG_STORAGE_PREFIX + group.id;
	var json = JSON.stringify(group);
	return storage.compress(json).then(function(base64) {
		try {
			localStorage.setItem(key, base64);
		} catch (e) {
			console.warn("minver-cg: localStorage write failed for group", group.id, e);
		}
	});
}

function loadGroup(groupId) {
	var key = CG_STORAGE_PREFIX + groupId;
	var data;
	try {
		data = localStorage.getItem(key);
	} catch (e) {
		return Promise.resolve(null);
	}
	if (!data) return Promise.resolve(null);
	return storage.decompress(data).then(function(json) {
		return JSON.parse(json);
	}).catch(function(e) {
		console.warn("minver-cg: failed to decompress group", groupId, e);
		return null;
	});
}

function deleteGroup(groupId) {
	var key = CG_STORAGE_PREFIX + groupId;
	try {
		localStorage.removeItem(key);
	} catch (e) {}
	return loadIndex().then(function(index) {
		index = index.filter(function(entry) {
			return entry.id !== groupId;
		});
		return saveIndex(index);
	});
}

function deleteAllGroups() {
	try {
		for (var i = localStorage.length - 1; i >= 0; i--) {
			var key = localStorage.key(i);
			if (key && (key.indexOf(CG_STORAGE_PREFIX) === 0 || key === CG_INDEX_KEY)) {
				localStorage.removeItem(key);
			}
		}
	} catch (e) {
		console.warn("minver-cg: failed to clear localStorage", e);
	}
	return Promise.resolve();
}

// --- Index persistence ---

function loadIndex() {
	var data;
	try {
		data = localStorage.getItem(CG_INDEX_KEY);
	} catch (e) {
		return Promise.resolve([]);
	}
	if (!data) return Promise.resolve([]);
	return storage.decompress(data).then(function(json) {
		return JSON.parse(json);
	}).catch(function(e) {
		console.warn("minver-cg: failed to decompress index", e);
		return [];
	});
}

function saveIndex(index) {
	if (index.length === 0) {
		try { localStorage.removeItem(CG_INDEX_KEY); } catch (e) {}
		return Promise.resolve();
	}
	var json = JSON.stringify(index);
	return storage.compress(json).then(function(base64) {
		try {
			localStorage.setItem(CG_INDEX_KEY, base64);
		} catch (e) {
			console.warn("minver-cg: localStorage write failed for index", e);
		}
	});
}

function hydrateIndex(wiki) {
	return loadIndex().then(function(index) {
		wiki.addTiddler(new $tw.Tiddler({
			title: TEMP_INDEX,
			text: JSON.stringify(index),
			type: "application/json"
		}));
		return index;
	});
}

// --- Eviction ---

function evictGroups(index, max) {
	if (max <= 0 || index.length <= max) return index;
	// Sort by startTime ascending (oldest first), remove oldest
	index.sort(function(a, b) { return a.startTime - b.startTime; });
	var evicted = index.slice(0, index.length - max);
	// Remove evicted groups from localStorage
	for (var i = 0; i < evicted.length; i++) {
		var key = CG_STORAGE_PREFIX + evicted[i].id;
		try { localStorage.removeItem(key); } catch (e) {}
	}
	return index.slice(index.length - max);
}

// --- Config ---

function getMaxGroups(wiki) {
	return parseInt(storage.getConfig(wiki, "max-groups", "10"), 10) || 10;
}

// --- Exports ---

exports.CG_STORAGE_PREFIX = CG_STORAGE_PREFIX;
exports.CG_INDEX_KEY = CG_INDEX_KEY;
exports.TEMP_INDEX = TEMP_INDEX;
exports.TEMP_RECORDING = TEMP_RECORDING;
exports.TEMP_ACTIVE_GROUP = TEMP_ACTIVE_GROUP;
exports.isRecording = isRecording;
exports.getActiveGroup = getActiveGroup;
exports.startRecording = startRecording;
exports.stopRecording = stopRecording;
exports.recordSave = recordSave;
exports.recordDelete = recordDelete;
exports.rollbackGroup = rollbackGroup;
exports.loadGroup = loadGroup;
exports.deleteGroup = deleteGroup;
exports.deleteAllGroups = deleteAllGroups;
exports.loadIndex = loadIndex;
exports.saveIndex = saveIndex;
exports.hydrateIndex = hydrateIndex;
exports.evictGroups = evictGroups;
exports.getMaxGroups = getMaxGroups;
