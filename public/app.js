import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  deleteField,
  getFirestore,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC1rhBwGhedFMm8GTAsJ53VnZjakfRHyZo",
  authDomain: "e5muhely.firebaseapp.com",
  projectId: "e5muhely",
  storageBucket: "e5muhely.firebasestorage.app",
  messagingSenderId: "147501507230",
  appId: "1:147501507230:web:27e0a6369af0ba022cd18f",
  measurementId: "G-KC0HDCLFS9",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const isCodespacesHost = window.location.hostname.endsWith(".app.github.dev");
const isEmulator = window.location.port === "5000"
  || window.location.hostname === "localhost"
  || window.location.hostname === "127.0.0.1"
  || isCodespacesHost;

if (isEmulator) {
  const emulatorHost = isCodespacesHost
    ? window.location.hostname.replace(/-5000(?=\.app\.github\.dev$)/, "-8080")
    : window.location.hostname;
  connectFirestoreEmulator(db, emulatorHost, 8080);
  console.info(`Firestore emulator: ${emulatorHost}:8080`);
}

function parseCurrencyValue(value) {
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const mnbHufRates = {
  EUR: null,
  USD: null,
};
const exchangeRateEndpoint = window.EAM_EXCHANGE_RATE_ENDPOINT || "";
const eurRateText = document.querySelector("#eur-rate");
const usdRateText = document.querySelector("#usd-rate");

const catalogs = {
  owner: [
    ["E", "EJA"], ["C", "Continental"], ["S", "Sütő Attila"],
    ["M", "Alkotó Műhely"], ["O", "Oli"],
  ],
  deviceType: [
    ["RO", "Robot"], ["EG", "Elektromos gép"], ["EE", "Elektromos eszköz"],
    ["NH", "Nem használati tárgy"], ["RE", "Rendezési eszköz"],
    ["BR", "Berendezés / bútor"], ["AL", "Alkatrész"], ["SZ", "Szerszám"],
    ["FE", "Fogyóeszköz"], ["MV", "Munkavédelem"], ["MC", "Microcontroller"],
    ["PS", "Project Set"],
  ],
  manufacturer: [
    ["00", "Nem releváns"], ["UL", "Ultimaker"], ["LN", "Lenovo"],
    ["XT", "XTool"], ["IK", "IKEA"], ["CC", "Másolat, nem eredeti"],
    ["RE", "Relam"], ["GE", "Genius"], ["MR", "Maker's Red Box"],
    ["AT", "Alpha Tools"], ["TP", "TP-Link"], ["AR", "Arduino"],
    ["EX", "EXTOL"], ["MB", "Micro:bit"], ["KT", "Kortext"],
    ["MW", "MAXWELL"], ["CR", "Creality"], ["LE", "LEGO"],
    ["VS", "ViewSonic"], ["CA", "Canon"], ["CB", "CraftBOT"],
    ["BO", "Bosch"], ["TB", "TeachBus"], ["BT", "BaseTech"],
    ["LO", "Logitech"], ["BA", "Bauhaus"], ["SK", "Skil"],
    ["PS", "Parkside"], ["TR", "Tracon"], ["HG", "Helgi"],
    ["HV", "HIKVision"], ["RO", "rotho"], ["DL", "DLink"],
    ["LX", "LUX-TOOLS"],
  ],
  model: [
    ["SP", "Spike"], ["PX", "Pixma"], ["CS", "Csavarhúzó"],
    ["VO", "Vonalzó"], ["BT", "Battery"], ["PR", "3D printer és alkatrészei"],
    ["FE", "Fume extractor"], ["BL", "Blankoló"], ["TZ", "Tűzőgép"],
    ["SK", "Szerszámkulcs"], ["RP", "Ragasztópisztoly"], ["DS", "Dísz"],
    ["AL", "Általános"], ["LQ", "Folyadék"], ["FR", "Forrasztási eszköz"],
    ["OE", "Oktatási eszköz"], ["IM", "Irat-megsemmisítő"],
    ["KB", "Keyboard"], ["EC", "Electronic component"], ["BO", "Boost"],
    ["TM", "Tolómérő"], ["PA", "Pad, asztal"], ["ME", "Menetmetsző, fúró / vágó"],
    ["HE", "Hőlégfúvó"], ["CP", "Csipesz"], ["KA", "Kalapács"],
    ["PD", "PenDrive"], ["RK", "Ráspolykészlet"], ["EV", "EV3"],
    ["FO", "Fogó"], ["OL", "Olló"], ["MC", "Micro:bit"], ["CA", "Kábel"],
    ["LV", "Lézervágó"], ["MO", "Monitor"], ["SC", "Sniccer"],
    ["MT", "Measuring tape"], ["HM", "Vonalzószerű hossz- és szögmérők"],
    ["TL", "Töltő (állomás)"], ["PV", "Papírvágó"], ["MM", "Multiméter"],
    ["KI", "Kiegészítő"], ["EG", "Egér"], ["LA", "Laptop"],
    ["IM", "Imbuszkulcs"], ["SW", "Switch"], ["SA", "Satú"],
    ["DK", "Dugókulcs"], ["UN", "UNO R3"], ["FU", "Fűrész"],
    ["RT", "Router"], ["SZ", "Szorító"], ["FG", "Fúrógép / fúró-csavarozó"],
    ["PI", "Papír-írószer"], ["TE", "Tárolási egység"],
  ],
};

const defaultSubtypes = [
  ["00", "Ismeretlen / általános"],
  ["01", "Önálló eszköz"],
  ["02", "Készletben"],
];

const subtypeRules = {
  CA: [
    ["01", "USB-A"],
    ["02", "USB-B"],
    ["03", "USB-C"],
    ["04", "USB-micro"],
    ["05", "jack"],
    ["06", "konnektor-csatlakozás"],
    ["07", "krokodil"],
    ["08", "VGA"],
    ["09", "DP"],
    ["00", "Egyéb"],
  ],
  PR: [
    ["00", "általános"],
    ["01", "Extruder"],
    ["02", "Motorok / mozgatás"],
    ["03", "alaplap, elektronika"],
  ],
  CS: [
    ["00", "cserélhető / szett"],
    ["01", "PH"],
    ["02", "SL"],
    ["03", "PZ"],
    ["04", "T"],
    ["05", "H"],
  ],
  SC: [
    ["01", "normál penge"],
    ["02", "vékony penge"],
  ],
  FR: [
    ["01", "forrasztóállomás"],
    ["02", "pákátartó"],
    ["03", "kompakt forrasztópáka"],
    ["04", "egyéb kiegészítők"],
  ],
  HG: [
    ["00", "Sárga"],
    ["01", "Kék"],
    ["02", "Zöld"],
  ],
  PD: [
    ["01", "USB-A"],
    ["02", "USB-C"],
  ],
  PI: [
    ["01", "ceruza"],
    ["02", "toll"],
    ["03", "filctoll"],
    ["04", "ecset"],
    ["05", "festék"],
    ["06", "ragasztó"],
  ],
  PA: [
    ["01", "tanuláshoz"],
    ["02", "munkaasztal"],
    ["03", "terepasztal / tárolásra használt"],
  ],
  TE: [
    ["01", "doboz"],
    ["02", "fiókos tároló"],
  ],
  AL: [
    ["01", "csak az eszköz"],
    ["02", "szett / készlet"],
  ],
  FG: [
    ["0", "ismeretlen"],
    ["1", "fúrógép"],
    ["2", "fúró-csavarozó"],
  ],
};

const splitSubtypeRules = {
  CA: {
    first: [
      ["1", "USB-A"], ["2", "USB-B"], ["3", "USB-C"], ["4", "USB-micro"],
      ["5", "jack"], ["6", "konnektor-csatlakozás"], ["7", "krokodil"],
      ["8", "VGA"], ["9", "DP"], ["0", "Egyéb"],
    ],
    second: [
      ["1", "USB-A"], ["2", "USB-B"], ["3", "USB-C"], ["4", "USB-micro"],
      ["5", "jack"], ["6", "konnektor-csatlakozás"], ["7", "krokodil"],
      ["8", "VGA"], ["9", "DP"], ["0", "Egyéb"],
    ],
  },
  FG: {
    first: [
      ["0", "ismeretlen"],
      ["1", "fúrógép"],
      ["2", "fúró-csavarozó"],
    ],
    second: [
      ["1", "önmagában"],
      ["2", "szett / készlet"],
    ],
  },
};

const form = document.querySelector("#inventory-form");
const saveButton = document.querySelector("#save-button");
const statusMessage = document.querySelector("#form-status");
const inventoryNumber = document.querySelector("#inventory-number");
const subtypeControls = document.querySelector("#subtype-controls");
const subtype = document.querySelector("#subtype");
const subtypeFirst = document.querySelector("#subtype-first");
const subtypeSecond = document.querySelector("#subtype-second");
const subtypeCustom = document.querySelector("#subtype-custom");
const serialInputs = document.querySelector("#serial-inputs");
const quantityInput = document.querySelector("#quantity");
const stickerCountInput = document.querySelector("#sticker-count");
const unitValueInput = document.querySelector("#unit-value");
const currencyInput = document.querySelector("#currency");
const hufValueRow = document.querySelector("#huf-value-row");
const hufValueInput = document.querySelector("#huf-value");
const defaultInventoryPreview = "XXX-00-XX00-00";
const maximumQuantity = 99;
const maximumGeneratedSerialInputs = 1000;
const parameterDocument = doc(db, "beallitasok", "parameterek");

function normalizeParameterEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => Array.isArray(entry)
    ? entry
    : [String(entry.code || ""), String(entry.label || "")]);
}

function serializeParameterEntries(entries) {
  return entries.map(([code, label]) => ({ code, label }));
}

async function loadParameterConfig() {
  const snapshot = await getDoc(parameterDocument);
  if (!snapshot.exists()) {
    return;
  }
  const saved = snapshot.data();
  for (const key of Object.keys(catalogs)) {
    if (Array.isArray(saved.catalogs?.[key])) {
      catalogs[key] = normalizeParameterEntries(saved.catalogs[key]);
    }
  }
  if (saved.subtypeRules && typeof saved.subtypeRules === "object") {
    Object.keys(subtypeRules).forEach((key) => delete subtypeRules[key]);
    Object.entries(saved.subtypeRules).forEach(([key, entries]) => {
      subtypeRules[key] = normalizeParameterEntries(entries);
    });
  }
  if (saved.splitSubtypeRules && typeof saved.splitSubtypeRules === "object") {
    Object.keys(splitSubtypeRules).forEach((key) => delete splitSubtypeRules[key]);
    Object.entries(saved.splitSubtypeRules).forEach(([key, rule]) => {
      splitSubtypeRules[key] = {
        first: normalizeParameterEntries(rule.first),
        second: normalizeParameterEntries(rule.second),
      };
    });
  }
}

try {
  await loadParameterConfig();
} catch (error) {
  console.error("Paraméterek betöltési hiba:", error);
}

function populateSelect(id, catalog) {
  const select = document.querySelector(`#${id}`);
  const placeholder = select.options[0];
  select.replaceChildren(placeholder);
  for (const [code, label] of catalog) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${code}: ${label}`;
    select.append(option);
  }
}

populateSelect("owner", catalogs.owner);
populateSelect("device-type", catalogs.deviceType);
populateSelect("manufacturer", catalogs.manufacturer);
populateSelect("model", catalogs.model);

function updateSubtypeOptions() {
  const model = document.querySelector("#model").value;
  const splitRules = splitSubtypeRules[model];
  const options = subtypeRules[model] || [
    ...defaultSubtypes,
    ["custom", "Egyéni szám"],
  ];

  if (splitRules) {
    subtype.hidden = true;
    subtypeFirst.hidden = false;
    subtypeSecond.hidden = false;
    subtypeCustom.hidden = true;
    subtypeCustom.required = false;
    subtypeCustom.value = "";
    subtypeControls.classList.add("subtype-controls--split");
    populateSubtypeSelect(subtypeFirst, "Első számjegy", splitRules.first);
    populateSubtypeSelect(subtypeSecond, "Második számjegy", splitRules.second);
    return;
  }

  subtype.hidden = false;
  subtypeFirst.hidden = true;
  subtypeSecond.hidden = true;
  subtypeCustom.hidden = true;
  subtypeControls.classList.remove("subtype-controls--split");
  populateSubtypeSelect(subtype, "Válassz altípust", options);
  subtypeCustom.required = false;
  updateCustomSubtypeVisibility();
}

function populateSubtypeSelect(select, placeholder, options) {
  select.replaceChildren(new Option(placeholder, ""));
  options.forEach(([code, label]) => {
    select.append(new Option(`${code}: ${label}`, code));
  });
}

function updateCustomSubtypeVisibility() {
  const isCustom = subtype.value === "custom";
  subtypeCustom.hidden = !isCustom;
  subtypeCustom.required = isCustom;
  if (!isCustom) {
    subtypeCustom.value = "";
  }
}

updateSubtypeOptions();
subtype.addEventListener("change", updateCustomSubtypeVisibility);
subtypeCustom.addEventListener("blur", () => {
  if (/^\d$/.test(subtypeCustom.value)) {
    subtypeCustom.value = subtypeCustom.value.padStart(2, "0");
  }
  updateInventoryPreview();
});

subtypeCustom.addEventListener("input", updateInventoryPreview);

function updateSerialInputs() {
  const requestedQuantity = Number(quantityInput.value);
  const quantity = Math.min(
    Number.isFinite(requestedQuantity) && requestedQuantity > 0 ? requestedQuantity : 1,
    maximumGeneratedSerialInputs,
  );
  serialInputs.replaceChildren();

  for (let index = 0; index < quantity; index += 1) {
    const input = document.createElement("input");
    input.id = index === 0 ? "serial-1" : `serial-${index + 1}`;
    input.name = "serialNumbers";
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = `${index + 1}. sorozatszám`;
    serialInputs.append(input);
  }
}

updateSerialInputs();

stickerCountInput.addEventListener("input", () => {
  const value = Number(stickerCountInput.value);
  if (Number.isFinite(value) && value > 10) {
    stickerCountInput.value = "10";
  }
});

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `form-status form-status--${type}`;
}

function getCodePrefix(data) {
  return `${data.tulajdonos}${data.eszkozTipus}-${data.gyartoMarka}-${data.tipus}${data.alTipus}`;
}

function getCounterPrefix(data) {
  return `${data.tulajdonos}${data.eszkozTipus}-${data.gyartoMarka}-${data.tipus}`;
}

function normalizeSubtype(model, firstDigit, secondDigit) {
  if (model !== "CA") {
    return `${firstDigit || "0"}${secondDigit || "0"}`;
  }

  const digits = [firstDigit || "0", secondDigit || "0"].sort((left, right) => (
    Number(right) - Number(left)
  ));
  return digits.join("");
}

function normalizeCustomSubtype(value) {
  return value.trim().padStart(2, "0");
}

function getFormData() {
  const data = new FormData(form);
  const model = data.get("model");
  const splitRules = splitSubtypeRules[model];
  const alTipus = splitRules
    ? normalizeSubtype(model, data.get("subtypeFirst"), data.get("subtypeSecond"))
    : data.get("subtype") === "custom"
      ? normalizeCustomSubtype(data.get("subtypeCustom"))
      : data.get("subtype") || "00";

  return {
    nev: data.get("name").trim(),
    darabszam: Number(data.get("quantity")),
    tulajdonos: data.get("owner"),
    eszkozTipus: data.get("deviceType"),
    gyartoMarka: data.get("manufacturer") || "00",
    tipus: data.get("model") || "00",
    alTipus,
    egysegErtek: parseCurrencyValue(data.get("unitValue")),
    penznem: data.get("currency") || "HUF",
    matricakSzama: Number(data.get("stickerCount")) || 0,
    matricaMeret: data.get("stickerSize") || "big",
    sorozatszamok: data.getAll("serialNumbers").map((value) => value.trim()).filter(Boolean),
    tarolasHelyeModja: data.get("storage").trim(),
    megjegyzes: data.get("notes").trim(),
    letrehozva: serverTimestamp(),
  };
}

function updateInventoryPreview() {
  const data = new FormData(form);
  const owner = data.get("owner") || "X";
  const deviceType = data.get("deviceType") || "XX";
  const manufacturer = data.get("manufacturer") || "00";
  const model = data.get("model") || "XX";
  const subtypeValue = data.get("model") && splitSubtypeRules[data.get("model")]
    ? normalizeSubtype(
      data.get("model"),
      data.get("subtypeFirst"),
      data.get("subtypeSecond"),
    )
    : data.get("subtype") === "custom"
      ? normalizeCustomSubtype(data.get("subtypeCustom") || "00")
      : data.get("subtype") || "00";
  const quantity = Number(data.get("quantity")) || 1;
  const suffix = quantity === 1
    ? "01"
    : `[01-${String(quantity).padStart(2, "0")}]`;
  inventoryNumber.textContent = `${owner}${deviceType}-${manufacturer}-${model}${subtypeValue}-${suffix}`;
}

function createInventoryNumbers(prefix, startNumber, quantity) {
  return Array.from(
    { length: quantity },
    (_, index) => `${prefix}-${String(startNumber + index).padStart(2, "0")}`,
  );
}

quantityInput.addEventListener("focus", () => {
  quantityInput.select();
});

quantityInput.addEventListener("input", () => {
  quantityInput.value = quantityInput.value.replace(/\D/g, "");
  if (Number(quantityInput.value) > maximumQuantity) {
    quantityInput.value = String(maximumQuantity);
  }
  updateSerialInputs();
  updateInventoryPreview();
});

form.querySelectorAll("select").forEach((input) => {
  input.addEventListener("change", updateInventoryPreview);
});
unitValueInput.addEventListener("input", () => {
  unitValueInput.value = unitValueInput.value.replace(/[^\d,.-]/g, "");
});
unitValueInput.addEventListener("focus", () => {
  const value = parseCurrencyValue(unitValueInput.value);
  unitValueInput.value = value == null ? "" : String(value);
  unitValueInput.select();
});
unitValueInput.addEventListener("blur", () => {
  const value = parseCurrencyValue(unitValueInput.value);
  unitValueInput.value = value == null ? "" : formatCurrency(value, currencyInput.value);
  updateHufValue();
});
unitValueInput.addEventListener("input", updateHufValue);
currencyInput.addEventListener("change", () => {
  const value = parseCurrencyValue(unitValueInput.value);
  unitValueInput.value = value == null ? "" : formatCurrency(value, currencyInput.value);
  updateHufValue();
});
document.querySelector("#model").addEventListener("change", () => {
  updateSubtypeOptions();
  updateInventoryPreview();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("", "");

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Mentés...";

  try {
    const data = getFormData();
    const prefix = getCodePrefix(data);
    const counterPrefix = getCounterPrefix(data);
    const counterRef = doc(db, "leltariSzamlalok", counterPrefix);
    const inventoryRef = doc(db, "eszkozok", counterPrefix);

    await runTransaction(db, async (transaction) => {
      const counterSnapshot = await transaction.get(counterRef);
      const inventorySnapshot = await transaction.get(inventoryRef);
      const currentNext = counterSnapshot.exists() ? counterSnapshot.data().kovetkezo : 0;
      console.info("Counter read", {
        path: `leltariSzamlalok/${counterPrefix}`,
        exists: counterSnapshot.exists(),
        next: currentNext,
        mode: isEmulator ? "emulator" : "production",
      });
      const startNumber = data.darabszam === 1 ? Math.max(currentNext, 1) : currentNext;
      if (startNumber + data.darabszam - 1 > 99) {
        throw new Error("A kétjegyű sorszámtartomány megtelt ehhez a kódhoz.");
      }
      const leltariSzamok = createInventoryNumbers(prefix, startNumber, data.darabszam);
      const existingItems = inventorySnapshot.exists()
        ? inventorySnapshot.data().sorszamok || {}
        : {};
      const newItems = { ...existingItems };

      transaction.set(counterRef, {
        prefix: counterPrefix,
        kovetkezo: startNumber + data.darabszam,
        frissitve: serverTimestamp(),
      });
      leltariSzamok.forEach((inventoryCode, index) => {
        const counter = inventoryCode.slice(inventoryCode.lastIndexOf("-") + 1);
        newItems[counter] = {
          leltariSzam: inventoryCode,
          alTipus: data.alTipus,
          name: data.nev,
          price: data.egysegErtek,
          currency: data.penznem,
          stickerCount: data.matricakSzama,
          stickerSize: data.matricaMeret,
          serialNumber: data.sorozatszamok[index] || "",
          placement: data.tarolasHelyeModja,
          comment: data.megjegyzes,
          letrehozva: serverTimestamp(),
        };
      });

      transaction.set(inventoryRef, {
        leltariSzamPrefix: counterPrefix,
        sorszamok: newItems,
        frissitve: serverTimestamp(),
      }, { merge: true });
    });

    form.reset();
    updateSubtypeOptions();
    updateSerialInputs();
    quantityInput.value = "1";
    stickerCountInput.value = "1";
    updateHufValue();
    inventoryNumber.textContent = defaultInventoryPreview;
    showStatus("Az eszköz sikeresen elmentve.", "success");
  } catch (error) {
    console.error("Firestore mentési hiba:", error);
    console.error("Firestore mód:", isEmulator ? "Emulátor" : "Éles adatbázis");
    const message = error instanceof Error && error.message.includes("kétjegyű")
      ? error.message
      : "A mentés nem sikerült. Ellenőrizd a Firebase konfigurációt és a jogosultságokat.";
    showStatus(message, "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Mentés";
  }
});

const inventoryBody = document.querySelector("#inventory-body");
const inventoryStatus = document.querySelector("#inventory-status");
const inventorySearch = document.querySelector("#inventory-search");
const inventoryOwnerFilter = document.querySelector("#inventory-owner-filter");
const inventoryDeviceTypeFilter = document.querySelector("#inventory-device-type-filter");
const inventoryModelFilter = document.querySelector("#inventory-model-filter");
const inventoryManufacturerFilter = document.querySelector("#inventory-manufacturer-filter");
const applyInventoryFilters = document.querySelector("#apply-inventory-filters");
const clearInventoryFilters = document.querySelector("#clear-inventory-filters");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const inventoryState = {
  items: [],
  sort: { key: "code", direction: "ascending" },
  editing: null,
};

function getInventoryCodePrefix(code, fallback) {
  return code?.replace(/-\d{2}$/, "") || fallback;
}

function getOwnerDeviceParts(combinedCode) {
  const match = catalogs.owner
    .flatMap(([ownerCode]) => catalogs.deviceType.map(([deviceCode]) => ({
      owner: ownerCode,
      deviceType: deviceCode,
      length: ownerCode.length + deviceCode.length,
    })))
    .filter(({ length }) => length === combinedCode.length)
    .find(({ owner, deviceType }) => `${owner}${deviceType}` === combinedCode);
  return match || { owner: combinedCode, deviceType: "" };
}

function getInventoryParts(prefix) {
  const segments = prefix.split("-");
  if (segments.length === 2) {
    const ownerDevice = getOwnerDeviceParts(segments[0]);
    return {
      ...ownerDevice,
      manufacturer: "00",
      model: segments[1].slice(0, 2),
      subtype: segments[1].slice(2),
    };
  }

  const [owner = "", deviceType = "", manufacturer = "", modelAndSubtype = ""] = segments;
  if (segments.length === 3 && deviceType === "00") {
    const ownerDevice = getOwnerDeviceParts(owner);
    return {
      ...ownerDevice,
      manufacturer: "00",
      model: segments[2].slice(0, 2),
      subtype: segments[2].slice(2),
    };
  }
  return {
    owner,
    deviceType,
    manufacturer,
    model: modelAndSubtype.slice(0, 2),
    subtype: modelAndSubtype.slice(2),
  };
}

function populateFilter(select, values) {
  const currentValue = select.value;
  select.replaceChildren(new Option("Mindegyik", ""));
  [...values].sort().forEach((value) => select.append(new Option(value, value)));
  select.value = values.has(currentValue) ? currentValue : "";
}

async function loadInventory() {
  inventoryStatus.textContent = "Leltár betöltése...";
  inventoryStatus.className = "form-status";
  try {
    const snapshot = await getDocs(collection(db, "eszkozok"));
    inventoryState.items = [];
    snapshot.forEach((parentSnapshot) => {
      const parentData = parentSnapshot.data();
      const items = parentData.sorszamok || {};
      Object.entries(items).forEach(([counter, item]) => {
        const code = item.leltariSzam || `${parentSnapshot.id}-${String(counter).padStart(2, "0")}`;
        const codePrefix = getInventoryCodePrefix(code, parentSnapshot.id);
        inventoryState.items.push({
          ...item,
          counter: String(counter).padStart(2, "0"),
          code,
          codePrefix,
          parentId: parentSnapshot.id,
          parentRef: parentSnapshot.ref,
          parts: getInventoryParts(codePrefix),
        });
      });
    });

    populateFilter(inventoryOwnerFilter, new Set(inventoryState.items.map((item) => item.parts.owner)));
    populateFilter(inventoryDeviceTypeFilter, new Set(inventoryState.items.map((item) => item.parts.deviceType)));
    populateFilter(inventoryModelFilter, new Set(inventoryState.items.map((item) => item.parts.model)));
    populateFilter(inventoryManufacturerFilter, new Set(inventoryState.items.map((item) => item.parts.manufacturer)));
    inventoryStatus.textContent = "";
    renderInventory();
  } catch (error) {
    console.error("Leltár betöltési hiba:", error);
    inventoryStatus.textContent = "A leltár betöltése nem sikerült.";
    inventoryStatus.className = "form-status form-status--error";
  }
}

function groupInventoryItems(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = [
      item.codePrefix,
      item.name || "",
      item.price ?? "",
      item.currency || "HUF",
      item.placement || "",
      item.comment || "",
    ].join("\u0000");
    if (!groups.has(key)) {
      groups.set(key, { ...item, items: [] });
    }
    groups.get(key).items.push(item);
  });
  return [...groups.values()];
}

function formatCounterRange(items) {
  if (items.length === 1) {
    return items[0].code;
  }

  const counters = items
    .map((item) => Number(item.counter))
    .sort((left, right) => left - right);
  const ranges = [];
  let start = counters[0];
  let end = start;
  counters.slice(1).forEach((counter) => {
    if (counter === end + 1) {
      end = counter;
      return;
    }
    ranges.push(start === end ? String(start).padStart(2, "0") : `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`);
    start = counter;
    end = counter;
  });
  if (counters.length) {
    ranges.push(start === end ? String(start).padStart(2, "0") : `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`);
  }
  return `${items[0].codePrefix}-[${ranges.join(",")}]`;
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "";
  row.append(cell);
}

function formatCurrency(value, currency = "HUF") {
  if (value == null || value === "") {
    return "";
  }
  return new Intl.NumberFormat("hu-HU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function updateExchangeRateText() {
  if (mnbHufRates.EUR == null || mnbHufRates.USD == null) {
    eurRateText.textContent = "EUR: Nem sikerült lekérni az élő adatokat.";
    usdRateText.textContent = "USD: Nem sikerült lekérni az élő adatokat.";
    return;
  }
  eurRateText.textContent = `1 EUR = ${mnbHufRates.EUR.toLocaleString("hu-HU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Ft`;
  usdRateText.textContent = `1 USD = ${mnbHufRates.USD.toLocaleString("hu-HU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Ft`;
}

async function loadExchangeRates() {
  if (!exchangeRateEndpoint) {
    updateExchangeRateText();
    updateHufValue();
    return;
  }
  try {
    const response = await fetch(exchangeRateEndpoint, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Exchange-rate proxy returned ${response.status}`);
    }
    const result = await response.json();
    const eur = Number(result.rates?.EUR);
    const usd = Number(result.rates?.USD);
    if (!Number.isFinite(eur) || !Number.isFinite(usd) || eur <= 0 || usd <= 0) {
      throw new Error("Exchange-rate proxy returned invalid rates");
    }
    mnbHufRates.EUR = eur;
    mnbHufRates.USD = usd;
    updateExchangeRateText();
    updateHufValue();
  } catch (error) {
    updateExchangeRateText();
    updateHufValue();
    console.warn("Live exchange rates could not be fetched.", error);
  }
}

function updateHufValue() {
  const value = parseCurrencyValue(unitValueInput.value);
  const isForeignCurrency = currencyInput.value !== "HUF";
  hufValueRow.hidden = !isForeignCurrency;
  document.querySelector("#unit-value").closest(".form-row")
    .classList.toggle("form-row--multiline", isForeignCurrency);
  hufValueInput.textContent = !isForeignCurrency || value == null
    ? ""
    : mnbHufRates[currencyInput.value] == null
      ? "Nem sikerült lekérni az élő adatokat."
      : formatCurrency(value * mnbHufRates[currencyInput.value], "HUF");
}

updateExchangeRateText();
loadExchangeRates();

function renderInventory() {
  const query = inventorySearch.value.trim().toLocaleLowerCase("hu-HU");
  const filtered = inventoryState.items.filter((item) => {
    const searchable = [item.name, item.code, item.serialNumber, item.placement, item.comment]
      .join(" ").toLocaleLowerCase("hu-HU");
    return (!query || searchable.includes(query))
      && (!inventoryOwnerFilter.value || item.parts.owner === inventoryOwnerFilter.value)
      && (!inventoryDeviceTypeFilter.value || item.parts.deviceType === inventoryDeviceTypeFilter.value)
      && (!inventoryModelFilter.value || item.parts.model === inventoryModelFilter.value)
      && (!inventoryManufacturerFilter.value || item.parts.manufacturer === inventoryManufacturerFilter.value);
  });
  const groups = groupInventoryItems(filtered).sort((left, right) => {
    const leftValue = left[inventoryState.sort.key] ?? "";
    const rightValue = right[inventoryState.sort.key] ?? "";
    const result = inventoryState.sort.key === "price"
      ? Number(leftValue || 0) - Number(rightValue || 0)
      : String(leftValue).localeCompare(String(rightValue), "hu");
    return inventoryState.sort.direction === "ascending" ? result : -result;
  });

  inventoryBody.replaceChildren();
  groups.forEach((group) => {
    const row = document.createElement("tr");
    appendCell(row, group.name);
    appendCell(row, formatCounterRange(group.items).replace(/-00-/, "-"));
    appendCell(row, formatCurrency(group.price, group.currency || "HUF"));
    appendCell(row, group.items.map((item) => item.serialNumber || "—").join(", "));
    appendCell(row, group.placement);
    appendCell(row, group.comment);
    inventoryBody.append(row);
  });
  if (!groups.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "Nincs megjeleníthető leltári tétel.";
    row.append(cell);
    inventoryBody.append(row);
  }
}

function openEditDialog(item) {
  inventoryState.editing = item;
  editForm.elements.name.value = item.name || "";
  editForm.elements.price.value = item.price ?? "";
  editForm.elements.serialNumber.value = item.serialNumber || "";
  editForm.elements.placement.value = item.placement || "";
  editForm.elements.comment.value = item.comment || "";
  editDialog.showModal();
}

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = inventoryState.editing;
  if (!item) return;
  const updatedItem = {
    ...item,
    name: editForm.elements.name.value.trim(),
    price: editForm.elements.price.value === "" ? null : Number(editForm.elements.price.value),
    serialNumber: editForm.elements.serialNumber.value.trim(),
    placement: editForm.elements.placement.value.trim(),
    comment: editForm.elements.comment.value.trim(),
  };
  try {
    await runTransaction(db, async (transaction) => {
      transaction.update(item.parentRef, {
        [`sorszamok.${item.counter}`]: {
          leltariSzam: item.code,
          alTipus: item.alTipus || "",
          name: updatedItem.name,
          price: updatedItem.price,
          serialNumber: updatedItem.serialNumber,
          placement: updatedItem.placement,
          comment: updatedItem.comment,
          letrehozva: item.letrehozva || serverTimestamp(),
        },
      });
    });
    editDialog.close();
    await loadInventory();
  } catch (error) {
    console.error("Leltári tétel módosítási hiba:", error);
    inventoryStatus.textContent = "A tétel módosítása nem sikerült.";
    inventoryStatus.className = "form-status form-status--error";
  }
});

async function deleteInventoryItem(item) {
  if (!window.confirm(`Biztosan törlöd a(z) ${item.code} tételt?`)) return;
  try {
    await runTransaction(db, async (transaction) => {
      transaction.update(item.parentRef, {
        [`sorszamok.${item.counter}`]: deleteField(),
      });
    });
    await loadInventory();
  } catch (error) {
    console.error("Leltári tétel törlési hiba:", error);
    inventoryStatus.textContent = "A tétel törlése nem sikerült.";
    inventoryStatus.className = "form-status form-status--error";
  }
}

const parameterEditor = {
  model: "",
};

let draggedParameterEntry = null;
let parameterDropPlaceholder = null;
let pointerDragState = null;

function createParameterEntry([code, label], onChange) {
  const row = document.createElement("div");
  row.className = "parameter-entry";
  const codeInput = document.createElement("input");
  codeInput.value = code;
  codeInput.maxLength = 8;
  codeInput.ariaLabel = "Kód";
  const labelInput = document.createElement("input");
  labelInput.value = label;
  labelInput.ariaLabel = "Megnevezés";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Törlés";
  remove.addEventListener("click", () => {
    row.remove();
    onChange();
  });
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "parameter-drag-handle";
  handle.textContent = "⋮⋮";
  handle.title = "Húzd az elem átrendezéséhez";
  handle.draggable = true;
  [codeInput, labelInput].forEach((input) => input.addEventListener("input", onChange));
  handle.addEventListener("dragstart", (event) => {
    const list = row.parentElement;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "parameter-entry");
    row.classList.add("parameter-entry--dragging");
    list.dataset.dragging = "true";
    draggedParameterEntry = row;
    parameterDropPlaceholder = document.createElement("div");
    parameterDropPlaceholder.className = "parameter-drop-placeholder";
    list.insertBefore(parameterDropPlaceholder, row);
  });
  handle.addEventListener("dragend", () => {
    const list = row.parentElement;
    row.hidden = false;
    delete list.dataset.dragging;
    parameterDropPlaceholder?.remove();
    draggedParameterEntry = null;
    parameterDropPlaceholder = null;
    onChange();
  });
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const list = row.parentElement;
    draggedParameterEntry = row;
    parameterDropPlaceholder = row.cloneNode(true);
    parameterDropPlaceholder.classList.add("parameter-drop-placeholder");
    parameterDropPlaceholder.hidden = false;
    parameterDropPlaceholder.setAttribute("aria-hidden", "true");
    parameterDropPlaceholder.querySelectorAll("input, button").forEach((control) => {
      control.tabIndex = -1;
    });
    list.insertBefore(parameterDropPlaceholder, row);
    row.hidden = true;
    row.classList.add("parameter-entry--dragging");
    list.dataset.dragging = "true";
    pointerDragState = { list, pointerId: event.pointerId };
    handle.setPointerCapture(event.pointerId);
  });
  row.append(codeInput, labelInput, remove, handle);
  return row;
}

document.addEventListener("dragover", (event) => {
  const list = event.target.closest(".parameter-entry-list");
  const draggedList = draggedParameterEntry?.parentElement;
  if (!list || !draggedParameterEntry || list !== draggedList) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const after = [...list.querySelectorAll(".parameter-entry:not([hidden]):not(.parameter-drop-placeholder)")]
    .find((entry) => event.clientY < entry.getBoundingClientRect().top + entry.offsetHeight / 2);
  list.insertBefore(parameterDropPlaceholder, after || null);
  if (event.clientY < 90) window.scrollBy(0, -12);
  if (event.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
});

document.addEventListener("drop", (event) => {
  const list = event.target.closest(".parameter-entry-list");
  const draggedList = draggedParameterEntry?.parentElement;
  if (!list || !draggedParameterEntry || list !== draggedList) return;
  event.preventDefault();
  list.insertBefore(draggedParameterEntry, parameterDropPlaceholder);
});

document.addEventListener("pointermove", (event) => {
  if (!pointerDragState || event.pointerId !== pointerDragState.pointerId) return;
  event.preventDefault();
  const { list } = pointerDragState;
  const after = [...list.querySelectorAll(".parameter-entry:not(.parameter-entry--dragging)")]
    .find((entry) => event.clientY < entry.getBoundingClientRect().top + entry.offsetHeight / 2);
  list.insertBefore(parameterDropPlaceholder, after || null);
  if (event.clientY < 90) window.scrollBy(0, -12);
  if (event.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
});

document.addEventListener("pointerup", (event) => {
  if (!pointerDragState || event.pointerId !== pointerDragState.pointerId) return;
  const { list } = pointerDragState;
  list.insertBefore(draggedParameterEntry, parameterDropPlaceholder);
  draggedParameterEntry.classList.remove("parameter-entry--dragging");
  draggedParameterEntry.hidden = false;
  delete list.dataset.dragging;
  parameterDropPlaceholder.remove();
  draggedParameterEntry = null;
  parameterDropPlaceholder = null;
  pointerDragState = null;
  readParameterCatalogs();
  readParameterRule();
});

function readParameterEntries(container) {
  return [...container.querySelectorAll(".parameter-entry")].map((row) => {
    const inputs = row.querySelectorAll("input");
    return [inputs[0].value.trim(), inputs[1].value.trim()];
  }).filter(([code, label]) => code && label);
}

function renderCatalogEditor(key) {
  const container = document.querySelector(`#parameter-${key}`);
  container.replaceChildren();
  const sync = () => {
    catalogs[key] = readParameterEntries(container);
  };
  catalogs[key].forEach((entry) => {
    container.append(createParameterEntry(entry, sync));
  });
}

function renderRuleEntries(containerId, entries) {
  const container = document.querySelector(`#${containerId}`);
  container.replaceChildren();
  const sync = () => readParameterRule();
  entries.forEach((entry) => container.append(createParameterEntry(entry, sync)));
}

function renderParameterRule() {
  const model = parameterEditor.model;
  const simplePanel = document.querySelector("#parameter-simple-rule");
  const splitPanel = document.querySelector("#parameter-split-rule");
  const mode = splitSubtypeRules[model] ? "split" : subtypeRules[model] ? "simple" : "none";
  document.querySelector("#parameter-rule-mode").value = mode;
  simplePanel.hidden = mode !== "simple";
  splitPanel.hidden = mode !== "split";
  simplePanel.replaceChildren();
  if (mode === "simple") {
    const list = document.createElement("div");
    list.id = "parameter-simple-list";
    list.className = "parameter-entry-list";
    simplePanel.append(list);
    renderRuleEntries("parameter-simple-list", subtypeRules[model]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button parameter-add-rule";
    button.textContent = "+ Altípus";
    button.addEventListener("click", () => {
      subtypeRules[model].push(["", ""]);
      renderParameterRule();
    });
    simplePanel.append(button);
  }

  if (mode === "split") {
    renderRuleEntries("parameter-split-first", splitSubtypeRules[model].first);
    renderRuleEntries("parameter-split-second", splitSubtypeRules[model].second);
  }
}

function setParameterRuleMode(mode) {
  const model = parameterEditor.model;
  delete subtypeRules[model];
  delete splitSubtypeRules[model];
  if (mode === "simple") {
    subtypeRules[model] = [...defaultSubtypes];
  } else if (mode === "split") {
    const digits = [["0", "Ismeretlen"]];
    splitSubtypeRules[model] = {
      first: [...digits],
      second: [...digits],
    };
  }
  renderParameterRule();
}

function renderParameterEditor() {
  Object.keys(catalogs).forEach(renderCatalogEditor);
  const modelSelect = document.querySelector("#parameter-model-select");
  modelSelect.replaceChildren(...catalogs.model.map(([code, label]) => new Option(`${code}: ${label}`, code)));
  parameterEditor.model = modelSelect.value || catalogs.model[0]?.[0] || "";
  modelSelect.value = parameterEditor.model;
  renderParameterRule();
}

function readParameterRule() {
  const model = parameterEditor.model;
  const mode = document.querySelector("#parameter-rule-mode").value;
  delete subtypeRules[model];
  delete splitSubtypeRules[model];
  if (mode === "simple") {
    const list = document.querySelector("#parameter-simple-list");
    subtypeRules[model] = list ? readParameterEntries(list) : [];
  }
  if (mode === "split") {
    const first = document.querySelector("#parameter-split-first");
    const second = document.querySelector("#parameter-split-second");
    splitSubtypeRules[model] = {
      first: first ? readParameterEntries(first) : [],
      second: second ? readParameterEntries(second) : [],
    };
  }
}

function readParameterCatalogs() {
  Object.keys(catalogs).forEach((key) => {
    catalogs[key] = readParameterEntries(document.querySelector(`#parameter-${key}`));
  });
}

async function saveParameterConfig() {
  readParameterCatalogs();
  readParameterRule();
  try {
    await setDoc(parameterDocument, {
      catalogs: Object.fromEntries(
        Object.entries(catalogs).map(([key, entries]) => [key, serializeParameterEntries(entries)]),
      ),
      subtypeRules: Object.fromEntries(
        Object.entries(subtypeRules).map(([key, entries]) => [key, serializeParameterEntries(entries)]),
      ),
      splitSubtypeRules: Object.fromEntries(
        Object.entries(splitSubtypeRules).map(([key, rule]) => [key, {
          first: serializeParameterEntries(rule.first),
          second: serializeParameterEntries(rule.second),
        }]),
      ),
    });
    parameterStatus.textContent = "A paraméterek mentése sikerült.";
    parameterStatus.className = "form-status form-status--success";
    populateSelect("owner", catalogs.owner);
    populateSelect("device-type", catalogs.deviceType);
    populateSelect("manufacturer", catalogs.manufacturer);
    populateSelect("model", catalogs.model);
    renderParameterEditor();
  } catch (error) {
    console.error("Paraméterek mentési hiba:", error);
    parameterStatus.textContent = "A paraméterek mentése nem sikerült.";
    parameterStatus.className = "form-status form-status--error";
  }
}

const parameterStatus = document.querySelector("#parameter-status");
document.querySelectorAll(".parameter-add").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.catalog;
    readParameterCatalogs();
    catalogs[key].push(["", ""]);
    renderCatalogEditor(key);
  });
});
document.querySelectorAll(".parameter-add-digit").forEach((button) => {
  button.addEventListener("click", () => {
    const model = parameterEditor.model;
    readParameterRule();
    if (!splitSubtypeRules[model]) {
      splitSubtypeRules[model] = { first: [], second: [] };
    }
    splitSubtypeRules[model][button.dataset.digit].push(["", ""]);
    renderParameterRule();
  });
});
document.querySelector("#parameter-model-select").addEventListener("change", (event) => {
  readParameterRule();
  parameterEditor.model = event.target.value;
  renderParameterRule();
});
document.querySelector("#parameter-rule-mode").addEventListener("change", () => {
  setParameterRuleMode(document.querySelector("#parameter-rule-mode").value);
});
document.querySelector("#save-parameters").addEventListener("click", saveParameterConfig);
renderParameterEditor();

document.querySelector("#cancel-edit").addEventListener("click", () => editDialog.close());
document.querySelector("#refresh-inventory").addEventListener("click", loadInventory);
applyInventoryFilters.addEventListener("click", renderInventory);
clearInventoryFilters.addEventListener("click", () => {
  inventorySearch.value = "";
  inventoryOwnerFilter.value = "";
  inventoryDeviceTypeFilter.value = "";
  inventoryModelFilter.value = "";
  inventoryManufacturerFilter.value = "";
  renderInventory();
});
document.querySelectorAll(".sort-button").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    inventoryState.sort = inventoryState.sort.key === key
      ? { key, direction: inventoryState.sort.direction === "ascending" ? "descending" : "ascending" }
      : { key, direction: "ascending" };
    renderInventory();
  });
});

document.querySelectorAll(".navigation-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    const page = link.dataset.page;
    if (page === "labels") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    document.querySelectorAll(".inventory-page").forEach((section) => {
      const targetId = page === "inventory" ? "leltar"
        : page === "parameters" ? "parameterek" : "uj-bevezetes";
      section.hidden = section.id !== targetId;
    });
    document.querySelectorAll(".navigation-link").forEach((navigationLink) => {
      navigationLink.classList.toggle("navigation-link--active", navigationLink === link);
    });
    if (page === "inventory") loadInventory();
    if (page === "parameters") renderParameterEditor();
    window.history.replaceState(null, "", link.hash);
  });
});

if (window.location.hash === "#uj-bevezetes") {
  document.querySelector('[data-page="entry"]').click();
} else if (window.location.hash === "#parameterek") {
  document.querySelector('[data-page="parameters"]').click();
} else {
  document.querySelector('[data-page="inventory"]').click();
}
