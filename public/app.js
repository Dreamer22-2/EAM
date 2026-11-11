import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  serverTimestamp,
  where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  INVENTORY_COUNTER_DOC_ID,
  INVENTORY_SCHEMA_VERSION,
  mutateInventoryStorage as mutateInventoryStorageData,
} from "./inventory-storage.js";

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
const auth = getAuth(app);
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
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
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
    letrehozva: new Date(),
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

    await runTransaction(db, async (transaction) => {
      const counterSnapshot = await transaction.get(inventoryCounterRef);
      const counterData = counterSnapshot.exists() ? counterSnapshot.data() : {};
      const currentNext = Number(counterData.nextByPrefix?.[counterPrefix]) || 0;
      console.info("Counter read", {
        path: `leltariSzamlalok/${INVENTORY_COUNTER_DOC_ID}`,
        exists: counterSnapshot.exists(),
        next: currentNext,
        mode: isEmulator ? "emulator" : "production",
      });
      const startNumber = data.darabszam === 1 ? Math.max(currentNext, 1) : currentNext;
      if (startNumber + data.darabszam - 1 > 99) {
        throw new Error("A kétjegyű sorszámtartomány megtelt ehhez a kódhoz.");
      }
      const leltariSzamok = createInventoryNumbers(prefix, startNumber, data.darabszam);
      const additions = leltariSzamok.map((inventoryCode, index) => {
        const counter = inventoryCode.slice(inventoryCode.lastIndexOf("-") + 1);
        return {
          codePrefix: prefix,
          record: {
            counter,
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
            letrehozva: data.letrehozva,
          },
        };
      });
      await mutateInventoryStorage(transaction, counterSnapshot, {
        additions,
        nextValues: { [counterPrefix]: startNumber + data.darabszam },
      });
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
const inventoryDetail = document.querySelector("#inventory-detail");
const inventoryDetailContent = document.querySelector("#inventory-detail-content");
const backToInventory = document.querySelector("#back-to-inventory");
const inventoryEditModal = document.querySelector("#inventory-edit-modal");
const inventoryEditForm = document.querySelector("#inventory-edit-form");
const inventoryEditHufValue = document.querySelector("#inventory-edit-huf-value");
const cancelInventoryEdit = document.querySelector("#cancel-inventory-edit");
const inventoryConfirmModal = document.querySelector("#inventory-confirm-modal");
const inventoryConfirmMessage = document.querySelector("#inventory-confirm-message");
const cancelInventoryDelete = document.querySelector("#cancel-inventory-delete");
const confirmInventoryDelete = document.querySelector("#confirm-inventory-delete");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const inventoryState = {
  items: [],
  sort: { key: "code", direction: "ascending" },
  editing: null,
};

const inventoryCounterRef = doc(db, "leltariSzamlalok", INVENTORY_COUNTER_DOC_ID);

function mutateInventoryStorage(transaction, counterSnapshot, options) {
  return mutateInventoryStorageData(transaction, counterSnapshot, {
    ...options,
    getShardRef: (shardId) => doc(db, "eszkozok", shardId),
    counterRef: inventoryCounterRef,
    serverTimestamp,
  });
}

const importFields = [
  ["code", "Leltári szám", true],
  ["name", "Név", true],
  ["owner", "Tulajdonos"],
  ["deviceType", "Eszköztípus"],
  ["manufacturer", "Gyártó/márka"],
  ["model", "Típus"],
  ["subtype", "Altípus"],
  ["price", "Egységérték"],
  ["currency", "Pénznem"],
  ["serialNumber", "Sorozatszám"],
  ["placement", "Tárolás helye, módja"],
  ["comment", "Megjegyzés"],
];

const importState = {
  workbook: null,
  rows: [],
  previewRows: [],
};
const importFile = document.querySelector("#import-file");
const importFileStatus = document.querySelector("#import-file-status");
const importOptions = document.querySelector("#import-options");
const importSheet = document.querySelector("#import-sheet");
const importHeaderRow = document.querySelector("#import-header-row");
const importFirstRow = document.querySelector("#import-first-row");
const importLastRow = document.querySelector("#import-last-row");
const importMapping = document.querySelector("#import-mapping");
const importPreviewCard = document.querySelector("#import-preview-card");
const importPreviewStatus = document.querySelector("#import-preview-status");
const importPreviewHead = document.querySelector("#import-preview-head");
const importPreviewBody = document.querySelector("#import-preview-body");
const importPreviewButton = document.querySelector("#import-preview-button");
const importConfirmButton = document.querySelector("#import-confirm-button");
const authButton = document.querySelector("#auth-button");
const authButtonIcon = document.querySelector("#auth-button-icon");
const authButtonLabel = document.querySelector("#auth-button-label");
const authUserLabel = document.querySelector("#auth-user-label");
const authGate = document.querySelector("#auth-gate");
const mainContent = document.querySelector(".main-content");
let authenticatedUser = null;
let hasAccess = false;

function setAuthStatus(user, access = false) {
  authenticatedUser = user;
  hasAccess = Boolean(user) && access;
  mainContent.classList.toggle("is-authenticated", hasAccess);
  authGate.hidden = hasAccess;
  document.querySelectorAll(".navigation-link").forEach((link) => {
    link.toggleAttribute("aria-disabled", !hasAccess);
    link.tabIndex = hasAccess ? 0 : -1;
  });
  authButtonIcon.src = user
    ? "/assets/icons/sign-out-2-svgrepo-com.svg"
    : "/assets/icons/sign-in-2-svgrepo-com.svg";
  authButtonLabel.textContent = user ? "Kijelentkezés" : "Bejelentkezés Google-lal";
  authButton.title = authButtonLabel.textContent;
  authUserLabel.hidden = !user;
  authUserLabel.textContent = user?.displayName || user?.email || "";
  authGate.querySelector("h1").textContent = user && !hasAccess
    ? "HOZZÁFÉRÉS MEGTAGADVA"
    : "BEJELENTKEZÉS SZÜKSÉGES";
  authGate.querySelector("p").textContent = user && !hasAccess
    ? "A felhasználói fiókod még nincs engedélyezve. Kérd az adminisztrátort, hogy állítsa a hasAccess mezőt true értékre."
    : "Az EAM leltár használatához jelentkezz be Google-fiókkal.";
}

async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    console.error("Google-bejelentkezési hiba:", error);
    authGate.querySelector("p").textContent = "A bejelentkezés nem sikerült. Próbáld újra.";
  }
}

async function signOutCurrentUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Kijelentkezési hiba:", error);
  }
}

authButton.addEventListener("click", () => {
  if (authenticatedUser) {
    signOutCurrentUser();
  } else {
    signInWithGoogle();
  }
});

onAuthStateChanged(auth, async (user) => {
  setAuthStatus(user, false);
  if (!user) return;
  try {
    const userRef = doc(db, "users", user.uid);
    const existingUserSnapshot = await getDoc(userRef);
    const profile = {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      lastSignInAt: serverTimestamp(),
    };
    if (existingUserSnapshot.exists()) {
      await setDoc(userRef, profile, { merge: true });
    } else {
      await setDoc(userRef, { ...profile, hasAccess: false });
    }
    const userSnapshot = await getDoc(userRef);
    const accessGranted = userSnapshot.exists() && userSnapshot.data().hasAccess === true;
    setAuthStatus(user, accessGranted);
    if (accessGranted) {
      document.querySelector('[data-page="inventory"]').click();
    }
  } catch (error) {
    console.error("Felhasználói profil mentési hiba:", error);
    authGate.querySelector("p").textContent = "A felhasználói profil betöltése nem sikerült.";
  }
});

function createIconButtonContent(button, iconPath, label) {
  const icon = document.createElement("img");
  icon.className = "button-icon";
  icon.src = iconPath;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  button.replaceChildren(icon);
  button.append(label);
}

function setImportStatus(message, type = "") {
  importFileStatus.textContent = message;
  importFileStatus.className = `form-status${type ? ` form-status--${type}` : ""}`;
}

function getImportSheetRows() {
  if (!importState.workbook) return [];
  const sheet = importState.workbook.Sheets[importSheet.value];
  return sheet ? window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) : [];
}

function renderImportMapping() {
  const rows = getImportSheetRows();
  const headerIndex = Math.max(Number(importHeaderRow.value) - 1, 0);
  const headers = rows[headerIndex] || [];
  importMapping.replaceChildren();
  importFields.forEach(([key, label, required]) => {
    const wrapper = document.createElement("label");
    const title = document.createElement("span");
    title.textContent = `${label}${required ? " *" : ""}`;
    const select = document.createElement("select");
    select.dataset.importField = key;
    select.append(new Option("— nincs hozzárendelve —", ""));
    headers.forEach((header, index) => {
      const text = String(header).trim();
      if (text) select.append(new Option(`${text} (oszlop ${index + 1})`, String(index)));
    });
    const likelyHeader = headers.findIndex((header) => String(header).trim().toLocaleLowerCase("hu-HU")
      === label.toLocaleLowerCase("hu-HU"));
    if (likelyHeader >= 0) select.value = String(likelyHeader);
    wrapper.append(title, select);
    importMapping.append(wrapper);
  });
  importLastRow.value = rows.length ? String(rows.length) : "";
  importFirstRow.value = String(Math.min(Number(importHeaderRow.value) + 1, Math.max(rows.length, 1)));
}

function normalizeImportCatalogValue(value, catalogKey) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = catalogs[catalogKey].find(([code, label]) => code === text || label.toLocaleLowerCase("hu-HU")
    === text.toLocaleLowerCase("hu-HU"));
  return match ? match[0] : text;
}

function readImportMapping() {
  return Object.fromEntries([...importMapping.querySelectorAll("select")].map((select) => [
    select.dataset.importField,
    select.value === "" ? null : Number(select.value),
  ]));
}

function getMergedCellValue(sheet, rowIndex, columnIndex) {
  const merge = (sheet["!merges"] || []).find((range) => (
    rowIndex >= range.s.r
      && rowIndex <= range.e.r
      && columnIndex >= range.s.c
      && columnIndex <= range.e.c
  ));
  if (!merge || (merge.s.r === rowIndex && merge.s.c === columnIndex)) return null;
  const address = window.XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
  return sheet[address]?.v ?? "";
}

function getImportValue(row, mapping, field, sheet, rowIndex) {
  const column = mapping[field];
  if (column == null) return "";
  const cellValue = row[column];
  const value = cellValue == null || String(cellValue).trim() === ""
    ? getMergedCellValue(sheet, rowIndex, column) ?? ""
    : cellValue;
  return String(value).trim();
}

function splitImportedSerialNumbers(value) {
  return String(value || "").trim().split(/[\s,;]+/).filter(Boolean);
}

function expandImportedInventoryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  const match = code.match(/^([\p{L}\p{N}]{3}-[\p{L}\p{N}]{2}-[\p{L}\p{N}]{4})-(\d{2,3}|\[([^\]]+)\])$/u);
  if (!match) return null;
  if (/^\d{2,3}$/.test(match[2])) return [`${match[1]}-${match[2]}`];
  const counters = match[3].split(",").map((counter) => counter.trim());
  if (counters.every((counter) => /^\d{2,3}$/.test(counter))) {
    return counters.map((counter) => `${match[1]}-${counter}`);
  }
  const range = match[3].match(/^(\d{2,3})-(\d{2,3})$/);
  if (!range) return null;
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (end < start) return null;
  const counterWidth = range[1].length;
  return Array.from({ length: end - start + 1 }, (_, index) => (
    `${match[1]}-${String(start + index).padStart(counterWidth, "0")}`
  ));
}

function describeInvalidInventoryCode(value) {
  const code = String(value || "").trim();
  const segments = code.split("-");
  const reasons = [];
  if (segments.length !== 4) {
    reasons.push(`${segments.length} kötőjellel elválasztott részt tartalmaz, 4 szükséges`);
  } else {
    if (!/^[\p{L}\p{N}]{3}$/u.test(segments[0])) reasons.push("az első résznek 3 betűből vagy számból kell állnia");
    if (!/^[\p{L}\p{N}]{2}$/u.test(segments[1])) reasons.push("a második résznek 2 betűből vagy számból kell állnia");
    if (!/^[\p{L}\p{N}]{4}$/u.test(segments[2])) reasons.push("a harmadik résznek 4 betűből vagy számból kell állnia");
    if (!/^(?:\d{2,3}|\[\d{2,3}-\d{2,3}\]|\[\d{2,3}(?:,\s*\d{2,3})+\])$/i.test(segments[3])) {
      reasons.push("az utolsó résznek két vagy három számjegynek, [00-05] tartománynak vagy [02, 05, 09] listának kell lennie");
    }
  }
  return `Érvénytelen leltári szám a(z) ${code || "(üres)"} értékben: `
    + `${reasons.join("; ")}. Elvárt forma: XXX-00-XX00-00 vagy XXX-00-XX00-000, `
    + `tartomány esetén például XXX-00-XX00-[69-119], lista esetén pedig `
    + `XXX-00-XX00-[02, 05, 09].`;
}

function buildImportRows() {
  const mapping = readImportMapping();
  const missing = importFields.filter(([, , required]) => required)
    .filter(([key]) => mapping[key] == null)
    .map(([, label]) => label);
  if (missing.length) {
    throw new Error(`Hiányzó kötelező oszlop-hozzárendelés: ${missing.join(", ")}.`);
  }

  const rows = getImportSheetRows();
  const sheet = importState.workbook.Sheets[importSheet.value];
  const codeColumn = mapping.code;
  const first = Math.max(Number(importFirstRow.value) - 1, 0);
  const last = Math.min(Number(importLastRow.value || rows.length), rows.length);
  if (first >= last) throw new Error("Az adat sorainak tartománya érvénytelen.");

  const seenCodes = new Set();
  const result = [];
  for (let index = first; index < last; index += 1) {
    const row = rows[index];
    if (!row?.some((value) => String(value ?? "").trim())) continue;
    const codeValue = getImportValue(row, mapping, "code", sheet, index);
    const name = getImportValue(row, mapping, "name", sheet, index);
    if (!codeValue && !name) continue;
    const codeMergeValue = codeColumn == null ? null : getMergedCellValue(sheet, index, codeColumn);
    const codeMerge = codeColumn == null ? null : (sheet["!merges"] || []).find((range) => (
      index >= range.s.r
        && index <= range.e.r
        && codeColumn >= range.s.c
        && codeColumn <= range.e.c
    ));
    const mergedCode = codeMerge && codeMerge.e.r > codeMerge.s.r;
    const expandedMergedCodes = mergedCode ? expandImportedInventoryCode(codeMergeValue || codeValue) : null;
    const mergedRowOffset = mergedCode ? index - codeMerge.s.r : 0;
    const codes = expandedMergedCodes && expandedMergedCodes.length === codeMerge.e.r - codeMerge.s.r + 1
      ? [expandedMergedCodes[mergedRowOffset]]
      : expandImportedInventoryCode(codeValue);
    if (!codes) {
      throw new Error(`A(z) ${index + 1}. sorban ${describeInvalidInventoryCode(codeValue)}`);
    }
    const serialNumbers = splitImportedSerialNumbers(getImportValue(row, mapping, "serialNumber", sheet, index));
    const serialNumbersMatch = serialNumbers.length === codes.length;
    codes.forEach((code, codeIndex) => {
      if (seenCodes.has(code)) throw new Error(`A leltári szám többször szerepel: ${code}.`);
      seenCodes.add(code);
      const codePrefix = getInventoryCodePrefix(code, "");
      const counter = code.match(/-(\d{2,3})$/)?.[1];
      result.push({
        code,
        codePrefix,
        counter,
        name,
        alTipus: getImportValue(row, mapping, "subtype", sheet, index),
        price: parseCurrencyValue(getImportValue(row, mapping, "price", sheet, index)),
        currency: getImportValue(row, mapping, "currency", sheet, index) || "HUF",
        serialNumber: serialNumbersMatch ? serialNumbers[codeIndex] : "",
        placement: getImportValue(row, mapping, "placement", sheet, index),
        comment: getImportValue(row, mapping, "comment", sheet, index),
        sourceRow: index + 1,
        parts: {
          owner: normalizeImportCatalogValue(getImportValue(row, mapping, "owner", sheet, index), "owner"),
          deviceType: normalizeImportCatalogValue(getImportValue(row, mapping, "deviceType", sheet, index), "deviceType"),
          manufacturer: normalizeImportCatalogValue(getImportValue(row, mapping, "manufacturer", sheet, index), "manufacturer"),
          model: normalizeImportCatalogValue(getImportValue(row, mapping, "model", sheet, index), "model"),
        },
      });
    });
  }
  return result;
}

function renderImportPreview(rows) {
  importState.previewRows = rows;
  importPreviewHead.replaceChildren();
  importPreviewBody.replaceChildren();
  const header = document.createElement("tr");
  ["Sor", "Leltári szám", "Név", "Egységérték", "Sorozatszám", "Tárolás helye, módja", "Megjegyzés"]
    .forEach((label) => header.append(Object.assign(document.createElement("th"), { textContent: label })));
  importPreviewHead.append(header);
  rows.slice(0, 100).forEach((item) => {
    const row = document.createElement("tr");
    [item.sourceRow, item.code, item.name, item.price == null ? "—" : formatCurrency(item.price, item.currency),
      item.serialNumber || "—", item.placement || "—", item.comment || "—"]
      .forEach((value) => row.append(Object.assign(document.createElement("td"), { textContent: value })));
    importPreviewBody.append(row);
  });
  importPreviewCard.hidden = false;
  importPreviewStatus.textContent = rows.length > 100
    ? `${rows.length} sor ellenőrizhető. Az előnézetből az első 100 látható.`
    : `${rows.length} sor lesz importálva.`;
  importPreviewStatus.className = "form-status form-status--success";
}

async function importPreview() {
  try {
    renderImportPreview(buildImportRows());
  } catch (error) {
    importState.previewRows = [];
    importPreviewCard.hidden = false;
    importPreviewStatus.textContent = error instanceof Error ? error.message : "Az előnézet nem készíthető el.";
    importPreviewStatus.className = "form-status form-status--error";
  }
}

async function importRowsToFirestore() {
  if (!importState.previewRows.length) return;
  importConfirmButton.disabled = true;
  importPreviewStatus.textContent = "Importálás folyamatban...";
  try {
    const importedAt = new Date();
    const grouped = new Map();
    importState.previewRows.forEach((item) => {
      if (!grouped.has(item.codePrefix)) grouped.set(item.codePrefix, []);
      grouped.get(item.codePrefix).push(item);
    });
    for (const [prefix, items] of grouped) {
      const counterPrefix = getCounterPrefixFromInventoryCode(items[0].code);
      await runTransaction(db, async (transaction) => {
        const counterSnapshot = await transaction.get(inventoryCounterRef);
        const counterData = counterSnapshot.exists() ? counterSnapshot.data() : {};
        const currentNext = Number(counterData.nextByPrefix?.[counterPrefix]) || 0;
        const highestImportedCounter = Math.max(...items.map((item) => Number(item.counter)));
        const nextCounter = Math.max(currentNext, highestImportedCounter + 1);
        const additions = items.map((item) => ({
          codePrefix: prefix,
          record: {
            counter: item.counter,
            leltariSzam: item.code,
            alTipus: item.alTipus,
            name: item.name,
            price: item.price,
            currency: item.currency,
            serialNumber: item.serialNumber,
            placement: item.placement,
            comment: item.comment,
            letrehozva: importedAt,
          },
        }));
        await mutateInventoryStorage(transaction, counterSnapshot, {
          additions,
          nextValues: { [counterPrefix]: nextCounter },
        });
      });
    }
    importPreviewStatus.textContent = `${importState.previewRows.length} sor sikeresen importálva.`;
    importPreviewStatus.className = "form-status form-status--success";
    await loadInventory();
  } catch (error) {
    console.error("Excel-importálási hiba:", error);
    importPreviewStatus.textContent = "Az importálás nem sikerült. Az adatok nem tekinthetők teljesen importáltnak.";
    importPreviewStatus.className = "form-status form-status--error";
  } finally {
    importConfirmButton.disabled = false;
  }
}

function getInventoryCodePrefix(code, fallback) {
  return code?.replace(/-\d{2,3}$/, "") || fallback;
}

function getCounterPrefixFromInventoryCode(code) {
  const segments = String(code || "").split("-");
  if (segments.length < 3) return getInventoryCodePrefix(code, "");
  const modelAndSubtype = segments[2];
  return `${segments[0]}-${segments[1]}-${modelAndSubtype.slice(0, 2)}`;
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

  if (segments.length === 3) {
    const [combinedOwnerDevice = "", manufacturer = "", modelAndSubtype = ""] = segments;
    return {
      owner: combinedOwnerDevice.slice(0, 1),
      deviceType: combinedOwnerDevice.slice(1, 3),
      manufacturer,
      model: modelAndSubtype.slice(0, 2),
      subtype: modelAndSubtype.slice(2),
    };
  }

  const [owner = "", deviceType = "", manufacturer = "", modelAndSubtype = ""] = segments;
  return {
    owner,
    deviceType,
    manufacturer,
    model: modelAndSubtype.slice(0, 2),
    subtype: modelAndSubtype.slice(2),
  };
}

function populateFilter(select, values, catalogKey) {
  const currentValue = select.value;
  select.replaceChildren(new Option("Mindegyik", ""));
  [...values].sort((left, right) => {
    const leftLabel = catalogs[catalogKey]?.find(([code]) => code === left)?.[1] || left;
    const rightLabel = catalogs[catalogKey]?.find(([code]) => code === right)?.[1] || right;
    return leftLabel.localeCompare(rightLabel, "hu");
  }).forEach((value) => {
    const label = catalogs[catalogKey]?.find(([code]) => code === value)?.[1] || value;
    select.append(new Option(label, value));
  });
  select.value = values.has(currentValue) ? currentValue : "";
}

async function loadInventory() {
  inventoryStatus.textContent = "Leltár betöltése...";
  inventoryStatus.className = "form-status";
  try {
    const counterSnapshot = await getDoc(inventoryCounterRef);
    if (!counterSnapshot.exists()
      || counterSnapshot.data().schemaVersion !== INVENTORY_SCHEMA_VERSION
      || counterSnapshot.data().migrationComplete !== true) {
      throw new Error("A leltár adattára még nincs átállítva. Futtasd előbb az adatköltöztetést.");
    }
    const snapshot = await getDocs(query(
      collection(db, "eszkozok"),
      where("schemaVersion", "==", INVENTORY_SCHEMA_VERSION),
    ));
    inventoryState.items = [];
    snapshot.forEach((shardSnapshot) => {
      Object.entries(shardSnapshot.data().groups || {}).forEach(([codePrefix, entries]) => {
        entries.forEach((item) => {
          const code = item.leltariSzam;
          inventoryState.items.push({
            ...item,
            counter: item.counter || code.slice(code.lastIndexOf("-") + 1),
            code,
            codePrefix,
            parentId: shardSnapshot.id,
            parentRef: shardSnapshot.ref,
            shardId: shardSnapshot.id,
            parts: getInventoryParts(codePrefix),
          });
        });
      });
    });

    populateFilter(inventoryOwnerFilter, new Set(inventoryState.items.map((item) => item.parts.owner)), "owner");
    populateFilter(inventoryDeviceTypeFilter, new Set(inventoryState.items.map((item) => item.parts.deviceType)), "deviceType");
    populateFilter(inventoryModelFilter, new Set(inventoryState.items.map((item) => item.parts.model)), "model");
    populateFilter(inventoryManufacturerFilter, new Set(inventoryState.items.map((item) => item.parts.manufacturer)), "manufacturer");
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

  const counters = [...new Set(items
    .map((item) => String(item.counter))
    .filter((counter) => /^\d+$/.test(counter)))]
    .map((counter) => Number(counter))
    .sort((left, right) => left - right);
  if (!counters.length) return items[0].code;

  const formatCounter = (counter) => String(counter).padStart(2, "0");
  const ranges = [];
  let start = counters[0];
  let end = start;
  const appendRange = () => {
    const first = formatCounter(start);
    const last = formatCounter(end);
    ranges.push(start === end ? first : `${first}-${last}`);
  };

  counters.slice(1).forEach((counter) => {
    if (counter === end + 1) {
      end = counter;
      return;
    }
    appendRange();
    start = counter;
    end = counter;
  });
  appendRange();
  return `${items[0].codePrefix}-[${ranges.join(", ")}]`;
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
  updateInventoryEditHufValue();
}

updateExchangeRateText();
loadExchangeRates();

function renderInventory() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const header = button.closest("th");
    if (button.dataset.sort === inventoryState.sort.key) {
      header.setAttribute("aria-sort", inventoryState.sort.direction);
    } else {
      header.removeAttribute("aria-sort");
    }
  });

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
    row.dataset.inventoryGroup = "true";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `${group.name || "Leltári tétel"} részleteinek megnyitása`);
    appendCell(row, group.name);
    appendCell(row, formatCounterRange(group.items));
    appendCell(row, formatCurrency(group.price, group.currency || "HUF"));
    appendCell(row, group.items.map((item) => item.serialNumber || "—").join(", "));
    appendCell(row, group.placement);
    appendCell(row, group.comment);
    const actions = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "row-actions";
    actionGroup.append(createIconAction("edit-alt-2-svgrepo-com.svg", "Szerkesztés", () => openInventoryEdit(group)));
    actionGroup.append(createIconAction("delete-alt-svgrepo-com.svg", "Törlés", () => requestInventoryDelete(group), true));
    actions.append(actionGroup);
    row.append(actions);
    const openDetails = () => openInventoryDetail(group);
    row.addEventListener("click", openDetails);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetails();
      }
    });
    inventoryBody.append(row);
  });
  if (!groups.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "Nincs megjeleníthető leltári tétel.";
    row.append(cell);
    inventoryBody.append(row);
  }
}

function createIconAction(iconName, label, handler, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-action${danger ? " icon-action--danger" : ""}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  const icon = document.createElement("img");
  icon.className = "button-icon";
  icon.src = `/assets/icons/${iconName}`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function populateInventoryEditCatalog(select, catalogKey) {
  select.replaceChildren();
  catalogs[catalogKey].forEach(([code, label]) => {
    select.append(new Option(label, code));
  });
}

["owner", "deviceType", "manufacturer", "model"].forEach((catalogKey) => {
  populateInventoryEditCatalog(inventoryEditForm.elements[catalogKey], catalogKey);
});

function openInventoryEdit(group) {
  inventoryState.editing = group;
  inventoryEditForm.elements.name.value = group.name || "";
  inventoryEditForm.elements.owner.value = group.parts.owner;
  inventoryEditForm.elements.deviceType.value = group.parts.deviceType;
  inventoryEditForm.elements.manufacturer.value = group.parts.manufacturer;
  inventoryEditForm.elements.model.value = group.parts.model;
  inventoryEditForm.elements.price.value = group.price ?? "";
  inventoryEditForm.elements.currency.value = group.currency || "HUF";
  inventoryEditForm.elements.placement.value = group.placement || "";
  inventoryEditForm.elements.comment.value = group.comment || "";
  updateInventoryEditHufValue();
  inventoryEditModal.hidden = false;
  inventoryEditForm.elements.name.focus();
}

function updateInventoryEditHufValue() {
  const value = Number(inventoryEditForm.elements.price.value);
  const currency = inventoryEditForm.elements.currency.value;
  const isForeignCurrency = currency !== "HUF";
  inventoryEditHufValue.hidden = !isForeignCurrency;
  if (!isForeignCurrency || !Number.isFinite(value)) {
    inventoryEditHufValue.textContent = "";
    return;
  }
  const rate = mnbHufRates[currency];
  inventoryEditHufValue.textContent = rate == null
    ? "HUF-ban: Nem sikerült lekérni az élő adatokat."
    : `HUF-ban: ${formatCurrency(value * rate, "HUF")}`;
}

function closeInventoryEdit() {
  inventoryEditModal.hidden = true;
  inventoryState.editing = null;
}

function requestInventoryDelete(target, singleItem = false) {
  const items = singleItem ? [target] : target.items;
  inventoryState.pendingDelete = { target, items, singleItem };
  inventoryConfirmMessage.textContent = singleItem
    ? `Biztosan törlöd a(z) ${target.code} leltári tételt?`
    : `Biztosan törlöd mind a ${items.length} tételt ebből a csoportból?`;
  inventoryConfirmModal.hidden = false;
  confirmInventoryDelete.focus();
}

async function deleteInventoryItems(items) {
  await runTransaction(db, async (transaction) => {
    const counterSnapshot = await transaction.get(inventoryCounterRef);
    await mutateInventoryStorage(transaction, counterSnapshot, {
      removals: items.map((item) => ({
        shardId: item.shardId,
        codePrefix: item.codePrefix,
        counter: item.counter,
        code: item.code,
      })),
    });
  });
}

async function confirmInventoryDeletion() {
  const pending = inventoryState.pendingDelete;
  if (!pending) return;
  confirmInventoryDelete.disabled = true;
  try {
    await deleteInventoryItems(pending.items);
    inventoryConfirmModal.hidden = true;
    inventoryState.pendingDelete = null;
    await loadInventory();
    if (!inventoryDetail.hidden) showInventoryPage();
  } catch (error) {
    console.error("Leltári tétel törlési hiba:", error);
    inventoryStatus.textContent = "A tétel törlése nem sikerült.";
    inventoryStatus.className = "form-status form-status--error";
  } finally {
    confirmInventoryDelete.disabled = false;
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

function appendDetailField(container, label, value) {
  const field = document.createElement("div");
  field.className = "inventory-detail-field";
  const title = document.createElement("dt");
  title.textContent = label;
  const content = document.createElement("dd");
  content.textContent = value || "—";
  field.append(title, content);
  container.append(field);
}

function openInventoryDetail(group) {
  const detailItems = group.items
    .slice()
    .sort((left, right) => Number(left.counter) - Number(right.counter));
  inventoryDetailContent.replaceChildren();

  const surface = document.createElement("div");
  surface.className = "inventory-detail-surface";
  const heading = document.createElement("h2");
  heading.className = "inventory-detail-heading";
  heading.textContent = group.name || "Névtelen leltári tétel";

  const fields = document.createElement("dl");
  fields.className = "inventory-detail-grid";
  appendDetailField(fields, "Leltári szám", formatCounterRange(detailItems));
  appendDetailField(fields, "Tulajdonos", catalogs.owner.find(([code]) => code === group.parts.owner)?.[1] || group.parts.owner);
  appendDetailField(fields, "Eszköztípus", catalogs.deviceType.find(([code]) => code === group.parts.deviceType)?.[1] || group.parts.deviceType);
  appendDetailField(fields, "Gyártó/márka", catalogs.manufacturer.find(([code]) => code === group.parts.manufacturer)?.[1] || group.parts.manufacturer);
  appendDetailField(fields, "Típus", catalogs.model.find(([code]) => code === group.parts.model)?.[1] || group.parts.model);
  appendDetailField(fields, "Egységérték", formatCurrency(group.price, group.currency || "HUF"));
  appendDetailField(fields, "Tárolás helye, módja", group.placement);
  appendDetailField(fields, "Megjegyzés", group.comment);
  const detailActions = document.createElement("div");
  detailActions.className = "detail-actions";
  detailActions.append(createIconAction("edit-alt-2-svgrepo-com.svg", "Szerkesztés", () => openInventoryEdit(group)));
  detailActions.append(createIconAction("delete-alt-svgrepo-com.svg", "Csoport törlése", () => requestInventoryDelete(group), true));

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-wrapper";
  const table = document.createElement("table");
  table.className = "inventory-table inventory-detail-items";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const hasSerialNumbers = detailItems.some((item) => {
    const serialNumber = String(item.serialNumber || "").trim();
    return serialNumber && serialNumber !== "-" && serialNumber !== "—";
  });
  ["Leltári szám", ...(hasSerialNumbers ? ["Sorozatszám(ok)"] : [])].forEach((label) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.append(cell);
  });
  head.append(headerRow);
  const body = document.createElement("tbody");
  detailItems.forEach((item) => {
    const row = document.createElement("tr");
    appendCell(row, item.code);
    if (hasSerialNumbers) appendCell(row, item.serialNumber || "—");
    const actions = document.createElement("td");
    actions.append(createIconAction("delete-alt-svgrepo-com.svg", "Tétel törlése", () => requestInventoryDelete(item, true), true));
    row.append(actions);
    body.append(row);
  });
  const actionsHeader = document.createElement("th");
  actionsHeader.textContent = "Műveletek";
  headerRow.append(actionsHeader);
  table.append(head, body);
  tableWrapper.append(table);
  surface.append(heading, fields, detailActions, tableWrapper);
  inventoryDetailContent.append(surface);

  document.querySelectorAll(".inventory-page").forEach((section) => {
    section.hidden = section !== inventoryDetail;
  });
  setActiveNavigation("inventory");
  window.history.replaceState(null, "", "#leltar-reszletek");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setActiveNavigation(page) {
  document.querySelectorAll(".navigation-link").forEach((navigationLink) => {
    navigationLink.classList.toggle("navigation-link--active", navigationLink.dataset.page === page);
  });
}

function showInventoryPage() {
  inventoryDetail.hidden = true;
  document.querySelector("#leltar").hidden = false;
  setActiveNavigation("inventory");
  window.history.replaceState(null, "", "#leltar");
}

const stickyTableHeader = document.createElement("div");
stickyTableHeader.className = "table-sticky-header";
stickyTableHeader.setAttribute("aria-hidden", "true");
document.body.append(stickyTableHeader);

const stickyTableHeaderMask = document.createElement("div");
stickyTableHeaderMask.className = "table-sticky-header-mask";
stickyTableHeaderMask.setAttribute("aria-hidden", "true");
document.body.append(stickyTableHeaderMask);

let stickyHeaderUpdatePending = false;
let stickyHeaderSourceTable = null;

function updateStickyTableHeader() {
  stickyHeaderUpdatePending = false;
  const activeTable = [...document.querySelectorAll(".table-wrapper .inventory-table")].find((table) => {
    const wrapper = table.closest(".table-wrapper");
    const header = table.tHead;
    if (!wrapper || !header?.rows.length || wrapper.clientWidth === 0) return false;
    const headerRect = header.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    return headerRect.top < 0 && wrapperRect.bottom > headerRect.height;
  });

  if (!activeTable) {
    stickyHeaderSourceTable = null;
    stickyTableHeader.classList.remove("is-visible");
    stickyTableHeaderMask.classList.remove("is-visible");
    stickyTableHeader.replaceChildren();
    return;
  }

  stickyHeaderSourceTable = activeTable;
  const wrapper = activeTable.closest(".table-wrapper");
  const header = activeTable.tHead;
  const wrapperRect = wrapper.getBoundingClientRect();
  const headerRect = header.getBoundingClientRect();
  const clonedTable = activeTable.cloneNode(false);
  const clonedHeader = header.cloneNode(true);
  clonedTable.removeAttribute("id");
  clonedTable.style.width = `${activeTable.offsetWidth}px`;
  clonedTable.style.minWidth = "0";
  clonedTable.style.transform = `translateX(-${wrapper.scrollLeft}px)`;
  clonedTable.append(clonedHeader);

  [...header.rows[0].cells].forEach((cell, index) => {
    const clonedCell = clonedHeader.rows[0].cells[index];
    if (clonedCell) clonedCell.style.width = `${cell.getBoundingClientRect().width}px`;
  });

  stickyTableHeader.style.left = `${wrapperRect.left}px`;
  stickyTableHeader.style.width = `${wrapperRect.width}px`;
  stickyTableHeader.style.height = `${headerRect.height + wrapper.clientTop}px`;
  stickyTableHeaderMask.style.left = stickyTableHeader.style.left;
  stickyTableHeaderMask.style.width = stickyTableHeader.style.width;
  stickyTableHeaderMask.style.height = stickyTableHeader.style.height;
  stickyTableHeader.replaceChildren(clonedTable);
  stickyTableHeader.classList.add("is-visible");
  stickyTableHeaderMask.classList.add("is-visible");
}

stickyTableHeader.addEventListener("click", (event) => {
  const sortButton = event.target.closest(".sort-button");
  if (!sortButton || !stickyHeaderSourceTable) return;
  const sourceButton = [...stickyHeaderSourceTable.tHead.querySelectorAll(".sort-button")]
    .find((button) => button.dataset.sort === sortButton.dataset.sort);
  sourceButton?.click();
  scheduleStickyHeaderUpdate();
});

function scheduleStickyHeaderUpdate() {
  if (stickyHeaderUpdatePending) return;
  stickyHeaderUpdatePending = true;
  window.requestAnimationFrame(updateStickyTableHeader);
}

document.addEventListener("scroll", scheduleStickyHeaderUpdate, true);
window.addEventListener("resize", scheduleStickyHeaderUpdate);
scheduleStickyHeaderUpdate();

backToInventory.addEventListener("click", showInventoryPage);
cancelInventoryEdit.addEventListener("click", closeInventoryEdit);
inventoryEditForm.elements.price.addEventListener("input", updateInventoryEditHufValue);
inventoryEditForm.elements.currency.addEventListener("change", updateInventoryEditHufValue);
cancelInventoryDelete.addEventListener("click", () => {
  inventoryConfirmModal.hidden = true;
  inventoryState.pendingDelete = null;
});
confirmInventoryDelete.addEventListener("click", confirmInventoryDeletion);

inventoryEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const group = inventoryState.editing;
  if (!group) return;
  const updates = {
    name: inventoryEditForm.elements.name.value.trim(),
    owner: inventoryEditForm.elements.owner.value,
    deviceType: inventoryEditForm.elements.deviceType.value,
    manufacturer: inventoryEditForm.elements.manufacturer.value,
    model: inventoryEditForm.elements.model.value,
    price: inventoryEditForm.elements.price.value === "" ? null : Number(inventoryEditForm.elements.price.value),
    currency: inventoryEditForm.elements.currency.value,
    placement: inventoryEditForm.elements.placement.value.trim(),
    comment: inventoryEditForm.elements.comment.value.trim(),
  };
  try {
    await runTransaction(db, async (transaction) => {
      const fallbackCreatedAt = new Date();
      const newPrefix = `${updates.owner}${updates.deviceType}-${updates.manufacturer}-${updates.model}${group.parts.subtype}`;
      const newCounterPrefix = `${updates.owner}${updates.deviceType}-${updates.manufacturer}-${updates.model}`;
      const counterSnapshot = await transaction.get(inventoryCounterRef);
      const counterData = counterSnapshot.exists() ? counterSnapshot.data() : {};
      const existingNext = Number(counterData.nextByPrefix?.[newCounterPrefix]) || 0;
      const highestGroupCounter = Math.max(...group.items.map((item) => Number(item.counter)));

      await mutateInventoryStorage(transaction, counterSnapshot, {
        rejectDuplicateCodes: true,
        removals: group.items.map((item) => ({
          shardId: item.shardId,
          codePrefix: item.codePrefix,
          counter: item.counter,
          code: item.code,
        })),
        additions: group.items.map((item) => ({
          codePrefix: newPrefix,
          record: {
            counter: item.counter,
            leltariSzam: `${newPrefix}-${item.counter}`,
            alTipus: item.alTipus || "",
            name: updates.name,
            price: updates.price,
            currency: updates.currency,
            stickerCount: item.stickerCount,
            stickerSize: item.stickerSize,
            serialNumber: item.serialNumber || "",
            placement: updates.placement,
            comment: updates.comment,
            letrehozva: item.letrehozva || fallbackCreatedAt,
          },
        })),
        nextValues: {
          [newCounterPrefix]: Math.max(existingNext, highestGroupCounter + 1),
        },
      });
    });
    closeInventoryEdit();
    await loadInventory();
    if (!inventoryDetail.hidden) {
      const updatedGroup = groupInventoryItems(inventoryState.items).find((item) => (
        item.codePrefix === `${updates.owner}${updates.deviceType}-${updates.manufacturer}-${updates.model}${group.parts.subtype}`
          && item.name === updates.name
      ));
      if (updatedGroup) openInventoryDetail(updatedGroup);
    }
  } catch (error) {
    console.error("Leltári csoport módosítási hiba:", error);
    inventoryStatus.textContent = error instanceof Error && error.message.includes("már tartozik")
      ? error.message
      : "A tétel módosítása nem sikerült.";
    inventoryStatus.className = "form-status form-status--error";
  }
});

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
      const fallbackCreatedAt = new Date();
      const counterSnapshot = await transaction.get(inventoryCounterRef);
      await mutateInventoryStorage(transaction, counterSnapshot, {
        removals: [{
          shardId: item.shardId,
          codePrefix: item.codePrefix,
          counter: item.counter,
          code: item.code,
        }],
        additions: [{
          codePrefix: item.codePrefix,
          record: {
            counter: item.counter,
            leltariSzam: item.code,
            alTipus: item.alTipus || "",
            name: updatedItem.name,
            price: updatedItem.price,
            currency: updatedItem.currency || "HUF",
            stickerCount: updatedItem.stickerCount,
            stickerSize: updatedItem.stickerSize,
            serialNumber: updatedItem.serialNumber,
            placement: updatedItem.placement,
            comment: updatedItem.comment,
            letrehozva: item.letrehozva || fallbackCreatedAt,
          },
        }],
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
    await deleteInventoryItems([item]);
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
  createIconButtonContent(remove, "/assets/icons/delete-alt-svgrepo-com.svg", "");
  remove.setAttribute("aria-label", "Törlés");
  remove.title = "Törlés";
  remove.addEventListener("click", () => {
    row.remove();
    onChange();
  });
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "parameter-drag-handle";
  createIconButtonContent(handle, "/assets/icons/drag-handle-svgrepo-com.svg", "");
  handle.setAttribute("aria-label", "Átrendezés");
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
    createIconButtonContent(button, "/assets/icons/add-plus-circle-svgrepo-com.svg", "Altípus");
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

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    if (!window.XLSX) throw new Error("Az Excel-olvasó nem töltődött be.");
    setImportStatus("Fájl beolvasása...");
    importState.workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    importSheet.replaceChildren();
    importState.workbook.SheetNames.forEach((name) => importSheet.append(new Option(name, name)));
    importOptions.hidden = false;
    importPreviewCard.hidden = true;
    renderImportMapping();
    setImportStatus(`${file.name}: ${importState.workbook.SheetNames.length} munkalap beolvasva.`, "success");
  } catch (error) {
    console.error("Excel-fájl beolvasási hiba:", error);
    importState.workbook = null;
    importOptions.hidden = true;
    setImportStatus("A fájl beolvasása nem sikerült. Ellenőrizd, hogy érvényes Excel-fájlt választottál.", "error");
  }
});
importSheet.addEventListener("change", renderImportMapping);
importHeaderRow.addEventListener("change", renderImportMapping);
importPreviewButton.addEventListener("click", importPreview);
importConfirmButton.addEventListener("click", importRowsToFirestore);

document.querySelectorAll(".navigation-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!hasAccess) {
      event.preventDefault();
      return;
    }
    const page = link.dataset.page;
    if (page === "labels") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    document.querySelectorAll(".inventory-page").forEach((section) => {
      const targetId = page === "inventory" ? "leltar"
        : page === "import" ? "importalas"
        : page === "parameters" ? "parameterek" : "uj-bevezetes";
      section.hidden = section.id !== targetId;
    });
    setActiveNavigation(page);
    if (page === "inventory") loadInventory();
    if (page === "parameters") renderParameterEditor();
    window.history.replaceState(null, "", link.hash);
  });
});

setAuthStatus(null);
