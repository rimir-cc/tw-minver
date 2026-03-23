/*\
title: $:/plugins/rimir/minver/storage.js
type: application/javascript
module-type: library
\*/
"use strict";

var STORAGE_PREFIX = "minver:";

// --- Compression via native CompressionStream ---

function compress(jsonString) {
	var blob = new Blob([jsonString]);
	var cs = new CompressionStream("deflate");
	var stream = blob.stream().pipeThrough(cs);
	return new Response(stream).blob().then(function(compressedBlob) {
		return compressedBlob.arrayBuffer();
	}).then(function(buffer) {
		var bytes = new Uint8Array(buffer);
		var binary = "";
		for (var i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	});
}

function decompress(base64String) {
	var binary = atob(base64String);
	var bytes = new Uint8Array(binary.length);
	for (var i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	var blob = new Blob([bytes]);
	var ds = new DecompressionStream("deflate");
	var stream = blob.stream().pipeThrough(ds);
	return new Response(stream).text();
}

// --- UUID generation ---

function generateId() {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	// Fallback
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
		var r = Math.random() * 16 | 0;
		var v = c === "x" ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

// --- Eviction ---

function evict(snapshots, maxManual, maxAuto) {
	var manual = [];
	var auto = [];
	for (var i = 0; i < snapshots.length; i++) {
		if (snapshots[i].type === "manual") {
			manual.push(snapshots[i]);
		} else {
			auto.push(snapshots[i]);
		}
	}
	// Sort by timestamp descending (newest first)
	manual.sort(function(a, b) { return b.timestamp - a.timestamp; });
	auto.sort(function(a, b) { return b.timestamp - a.timestamp; });
	// Keep only max
	if (maxManual > 0 && manual.length > maxManual) {
		manual = manual.slice(0, maxManual);
	}
	if (maxAuto > 0 && auto.length > maxAuto) {
		auto = auto.slice(0, maxAuto);
	}
	// Return manual first, then auto (both newest-first)
	return manual.concat(auto);
}

// --- Temp tiddler helpers ---

var TEMP_PREFIX = "$:/temp/minver/snapshots/";

function getTempTitle(tiddlerTitle) {
	return TEMP_PREFIX + tiddlerTitle;
}

function getSnapshotsFromStore(wiki, tiddlerTitle) {
	var tempTitle = getTempTitle(tiddlerTitle);
	var tiddler = wiki.getTiddler(tempTitle);
	if (!tiddler) return [];
	try {
		return JSON.parse(tiddler.fields.text) || [];
	} catch (e) {
		return [];
	}
}

function saveSnapshotsToStore(wiki, tiddlerTitle, snapshots) {
	var tempTitle = getTempTitle(tiddlerTitle);
	if (!snapshots || snapshots.length === 0) {
		wiki.deleteTiddler(tempTitle);
	} else {
		wiki.addTiddler(new $tw.Tiddler({
			title: tempTitle,
			text: JSON.stringify(snapshots),
			type: "application/json"
		}));
	}
}

// --- localStorage R/W (async, compressed) ---

function saveToLocalStorage(tiddlerTitle, snapshots) {
	var key = STORAGE_PREFIX + tiddlerTitle;
	if (snapshots.length === 0) {
		try { localStorage.removeItem(key); } catch (e) {}
		return Promise.resolve();
	}
	var json = JSON.stringify(snapshots);
	return compress(json).then(function(base64) {
		try {
			localStorage.setItem(key, base64);
		} catch (e) {
			console.warn("minver: localStorage write failed for", tiddlerTitle, e);
		}
	});
}

function loadFromLocalStorage(tiddlerTitle) {
	var key = STORAGE_PREFIX + tiddlerTitle;
	var data;
	try {
		data = localStorage.getItem(key);
	} catch (e) {
		return Promise.resolve([]);
	}
	if (!data) return Promise.resolve([]);
	return decompress(data).then(function(json) {
		return JSON.parse(json);
	}).catch(function(e) {
		console.warn("minver: failed to decompress", tiddlerTitle, e);
		return [];
	});
}

function loadAllFromLocalStorage() {
	var result = {};
	var keys = [];
	try {
		for (var i = 0; i < localStorage.length; i++) {
			var key = localStorage.key(i);
			if (key && key.indexOf(STORAGE_PREFIX) === 0) {
				keys.push(key);
			}
		}
	} catch (e) {
		return Promise.resolve(result);
	}
	if (keys.length === 0) return Promise.resolve(result);
	var promises = keys.map(function(key) {
		var title = key.substring(STORAGE_PREFIX.length);
		return loadFromLocalStorage(title).then(function(snapshots) {
			if (snapshots && snapshots.length > 0) {
				result[title] = snapshots;
			}
		});
	});
	return Promise.all(promises).then(function() {
		return result;
	});
}

function getAllLocalStorageKeys() {
	var titles = [];
	try {
		for (var i = 0; i < localStorage.length; i++) {
			var key = localStorage.key(i);
			if (key && key.indexOf(STORAGE_PREFIX) === 0) {
				titles.push(key.substring(STORAGE_PREFIX.length));
			}
		}
	} catch (e) {}
	return titles;
}

function getLocalStorageUsage() {
	var totalBytes = 0;
	try {
		for (var i = 0; i < localStorage.length; i++) {
			var key = localStorage.key(i);
			if (key && key.indexOf(STORAGE_PREFIX) === 0) {
				var val = localStorage.getItem(key);
				if (val) totalBytes += key.length * 2 + val.length * 2; // UTF-16
			}
		}
	} catch (e) {}
	return totalBytes;
}

// --- Field serialization ---

function serializeTiddlerFields(rawFields) {
	var fields = {};
	for (var field in rawFields) {
		if (Object.prototype.hasOwnProperty.call(rawFields, field)) {
			var val = rawFields[field];
			if (val instanceof Date) {
				fields[field] = $tw.utils.stringifyDate(val);
			} else if (Array.isArray(val)) {
				fields[field] = $tw.utils.stringifyList(val);
			} else {
				fields[field] = String(val);
			}
		}
	}
	return fields;
}

// --- Snapshot creation ---

function captureTiddlerFields(wiki, title, useDraft) {
	var tiddler;
	if (useDraft) {
		var draftTitle = wiki.findDraft(title);
		if (draftTitle) {
			tiddler = wiki.getTiddler(draftTitle);
		}
	}
	if (!tiddler) {
		tiddler = wiki.getTiddler(title);
	}
	if (!tiddler) return null;
	var fields = serializeTiddlerFields(tiddler.fields);
	// Remove draft fields — store original title
	if (fields["draft.of"]) {
		fields.title = fields["draft.of"];
		delete fields["draft.of"];
		delete fields["draft.title"];
	}
	return fields;
}

function createSnapshot(type, label, fields) {
	return {
		id: generateId(),
		timestamp: Date.now(),
		label: label || "snapshot-" + Date.now(),
		type: type || "manual",
		fields: fields
	};
}

// --- Config helpers ---

function getConfig(wiki, name, defaultVal) {
	var tiddler = wiki.getTiddler("$:/config/rimir/minver/" + name);
	if (tiddler && tiddler.fields.text !== undefined && tiddler.fields.text !== "") {
		return tiddler.fields.text;
	}
	return defaultVal;
}

function getMaxManual(wiki) {
	return parseInt(getConfig(wiki, "max-manual", "3"), 10) || 3;
}

function getMaxAuto(wiki) {
	return parseInt(getConfig(wiki, "max-auto", "3"), 10) || 3;
}

function getScopeFilter(wiki) {
	return getConfig(wiki, "scope-filter", "[all[]]");
}

function isAutoToStorage(wiki) {
	return getConfig(wiki, "auto-to-storage", "no") === "yes";
}

// --- Shared helpers ---

function fieldsEqual(a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	var keysA = Object.keys(a);
	var keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (var i = 0; i < keysA.length; i++) {
		if (a[keysA[i]] !== b[keysA[i]]) return false;
	}
	return true;
}

function findSnapshot(snapshots, snapshotId) {
	for (var i = 0; i < snapshots.length; i++) {
		if (snapshots[i].id === snapshotId) {
			return snapshots[i];
		}
	}
	return null;
}

function updateStorageUsage() {
	var bytes = getLocalStorageUsage();
	var label;
	if (bytes < 1024) {
		label = bytes + " B";
	} else if (bytes < 1024 * 1024) {
		label = (bytes / 1024).toFixed(1) + " KB";
	} else {
		label = (bytes / (1024 * 1024)).toFixed(2) + " MB";
	}
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/minver/storage-usage",
		text: label
	}));
}

// --- Exports ---

exports.compress = compress;
exports.decompress = decompress;
exports.generateId = generateId;
exports.evict = evict;
exports.getTempTitle = getTempTitle;
exports.getSnapshotsFromStore = getSnapshotsFromStore;
exports.saveSnapshotsToStore = saveSnapshotsToStore;
exports.saveToLocalStorage = saveToLocalStorage;
exports.loadFromLocalStorage = loadFromLocalStorage;
exports.loadAllFromLocalStorage = loadAllFromLocalStorage;
exports.getAllLocalStorageKeys = getAllLocalStorageKeys;
exports.getLocalStorageUsage = getLocalStorageUsage;
exports.captureTiddlerFields = captureTiddlerFields;
exports.createSnapshot = createSnapshot;
exports.getConfig = getConfig;
exports.getMaxManual = getMaxManual;
exports.getMaxAuto = getMaxAuto;
exports.getScopeFilter = getScopeFilter;
exports.isAutoToStorage = isAutoToStorage;
exports.serializeTiddlerFields = serializeTiddlerFields;
exports.fieldsEqual = fieldsEqual;
exports.findSnapshot = findSnapshot;
exports.updateStorageUsage = updateStorageUsage;
exports.TEMP_PREFIX = TEMP_PREFIX;
exports.STORAGE_PREFIX = STORAGE_PREFIX;
