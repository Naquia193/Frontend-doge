// Added by assistant: set backend base URL (replace with Railway URL)
const BACKEND_BASE_URL = "https://REPLACE_WITH_RAILWAY_URL";

// script.js PRO - integrado com backend + sync offline
// Backend base URL (fornecido pelo utilizador)
const API_URL = "https://passosemdoge.onrender.com";

// PIN de segurança local (fallback)
const LOCAL_PIN = "1234";

// --- Estado local ---
let steps = parseInt(localStorage.getItem("steps") || "0");
let doge = parseInt(localStorage.getItem("doge") || "0");
let wallet = localStorage.getItem("wallet") || "Sem endereço";
let loggedIn = localStorage.getItem("loggedIn") === "true";

// outbox para operações pendentes quando offline
// cada item: { type: "steps"|"withdraw"|"wallet", payload: {...}, ts: Date.now() }
let outbox = JSON.parse(localStorage.getItem("outbox") || "[]");

// util: guarda estado no localStorage
function persistLocalState() {
    localStorage.setItem("steps", steps);
    localStorage.setItem("doge", doge);
    localStorage.setItem("wallet", wallet);
    localStorage.setItem("outbox", JSON.stringify(outbox));
    localStorage.setItem("loggedIn", loggedIn ? "true" : "false");
}

// --- Render UI ---
function render() {
    const elSteps = document.getElementById("steps");
    const elDoge = document.getElementById("doge");
    const elWallet = document.getElementById("walletAddress");
    if (elSteps) elSteps.textContent = steps;
    if (elDoge) elDoge.textContent = doge;
    if (elWallet) elWallet.textContent = wallet;
}

// --- Queue / Outbox helpers ---
function queueOp(item) {
    outbox.push(item);
    persistLocalState();
}

// envia um item ao backend (utilizado internamente)
async function flushOutboxOnce() {
    if (!navigator.onLine) return;
    if (outbox.length === 0) return;

    // copiamos para tentar sem bloquear acesso caso alguma falhe
    const pending = outbox.slice();
    const newOutbox = [];

    for (const item of pending) {
        try {
            if (item.type === "steps") {
                await fetch(`${API_URL}/api/steps`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(item.payload),
                });
            } else if (item.type === "withdraw") {
                await fetch(`${API_URL}/api/withdraw`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(item.payload),
                });
            } else if (item.type === "wallet") {
                await fetch(`${API_URL}/api/wallet`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(item.payload),
                });
            } else {
                // se desconhecido, manter em fila para análise ou descartar
                newOutbox.push(item);
            }
        } catch (err) {
            // falha de rede ou servidor -> mantemos o item em outbox para tentar mais tarde
            console.warn("flushOutboxOnce - falha ao enviar:", item, err);
            newOutbox.push(item);
        }
    }

    outbox = newOutbox;
    persistLocalState();
}

// chamamos periodicamente para garantir flush
function startOutboxFlushLoop() {
    // tenta imediatamente e a cada 10s
    flushOutboxOnce();
    setInterval(flushOutboxOnce, 10000);
    // também tenta quando voltamos online
    window.addEventListener("online", () => {
        console.log("Voltou a estar online — sincronizando outbox...");
        flushOutboxOnce();
    });
}

// --- Backend interactions (tentativas com fallback) ---

// valida PIN no backend; se falhar, usa LOCAL_PIN (fallback)
async function validatePin(pin) {
    try {
        const res = await fetch(`${API_URL}/api/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin }),
        });
        if (!res.ok) {
            // server respondeu com erro (p.ex. 401)
            const text = await res.text();
            console.warn("validatePin - server response not ok:", res.status, text);
            return false;
        }
        const json = await res.json();
        // assumimos retorno { success: true } ou similar
        return !!json.success;
    } catch (err) {
        console.warn("validatePin - erro na chamada ao backend, fallback local", err);
        // fallback local
        return pin === LOCAL_PIN;
    }
}

// envia passos ao backend (ou enfileira se offline)
async function sendStepsToBackend(delta = 0) {
    const payload = { steps, doge, wallet, delta, ts: Date.now() };
    if (!navigator.onLine) {
        queueOp({ type: "steps", payload });
        return false;
    }
    try {
        const res = await fetch(`${API_URL}/api/steps`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            // se erro server, enfileira para posterior
            queueOp({ type: "steps", payload });
            return false;
        }
        const json = await res.json();
        // backend pode devolver saldos atualizados — atualiza se existir
        if (json.steps != null) steps = parseInt(json.steps);
        if (json.doge != null) doge = parseInt(json.doge);
        persistLocalState();
        render();
        return true;
    } catch (err) {
        console.warn("sendStepsToBackend - erro, enfileirando", err);
        queueOp({ type: "steps", payload });
        return false;
    }
}

// pede geração de carteira ao backend; se falhar, gera localmente
async function requestWalletFromBackend() {
    const payload = { ts: Date.now() };
    if (!navigator.onLine) {
        // enfileira pedido de geração no servidor e gera localmente como fallback
        queueOp({ type: "wallet", payload });
        const local = generateLocalWallet();
        wallet = local;
        persistLocalState();
        render();
        return local;
    }
    try {
        const res = await fetch(`${API_URL}/api/wallet`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("wallet endpoint respondeu com erro");
        const json = await res.json();
        if (json.address) {
            wallet = json.address;
            persistLocalState();
            render();
            return wallet;
        } else {
            // fallback local
            const local = generateLocalWallet();
            wallet = local;
            persistLocalState();
            render();
            return local;
        }
    } catch (err) {
        console.warn("requestWalletFromBackend - erro, gerando local:", err);
        const local = generateLocalWallet();
        wallet = local;
        persistLocalState();
        render();
        return local;
    }
}

// envia pedido de levantamento ao backend (ou enfileira)
async function sendWithdrawRequest(addr, amt) {
    const payload = { address: addr, amount: amt, wallet, ts: Date.now() };
    if (!navigator.onLine) {
        queueOp({ type: "withdraw", payload });
        return { ok: false, queued: true, message: "Offline — pedido enfileirado." };
    }
    try {
        const res = await fetch(`${API_URL}/api/withdraw`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const txt = await res.text();
            console.warn("sendWithdrawRequest - server error:", res.status, txt);
            return { ok: false, message: "Erro do servidor: " + txt };
        }
        const json = await res.json();
        // backend confirma e possivelmente atualiza saldo
        if (json.doge != null) {
            doge = parseInt(json.doge);
            persistLocalState();
            render();
        }
        return { ok: true, message: json.message || "Pedido enviado com sucesso." };
    } catch (err) {
        console.warn("sendWithdrawRequest - erro, enfileirando", err);
        queueOp({ type: "withdraw", payload });
        return { ok: false, queued: true, message: "Erro de rede — pedido enfileirado." };
    }
}

// --- Utilities ---
function generateLocalWallet() {
    return "DOGE-" + Math.random().toString(36).substring(2, 12).toUpperCase();
}

// --- UI Actions ---

async function login() {
    const pin = document.getElementById("pinInput")?.value || "";
    const loginErrorEl = document.getElementById("loginError");
    if (loginErrorEl) loginErrorEl.textContent = "";

    const valid = await validatePin(pin);
    if (valid) {
        // mostra app
        document.getElementById("loginBox").style.display = "none";
        document.getElementById("appBox").style.display = "block";
        document.getElementById("walletBox").style.display = "block";
        document.getElementById("withdrawBox").style.display = "block";
        loggedIn = true;
        persistLocalState();
        render();
        // tenta sincronizar dados pendentes
        flushOutboxOnce();
    } else {
        if (loginErrorEl) loginErrorEl.textContent = "PIN incorreto!";
    }
}

function logout() {
    loggedIn = false;
    persistLocalState();
    // simples: mostra login outra vez
    document.getElementById("loginBox").style.display = "block";
    document.getElementById("appBox").style.display = "none";
}

// adicionar passos local + sincronizar
async function addStepLocalAndSync() {
    steps++;
    // regra atual: 1 passo = 1 doge
    if (steps % 1 === 0) doge++;
    persistLocalState();
    render();
    // tenta enviar ao backend (ou enfileirar)
    await sendStepsToBackend(1);
}

// gerar carteira (botão)
async function onGenerateWalletClicked() {
    const el = document.getElementById("generateWalletBtn");
    if (el) el.disabled = true;
    await requestWalletFromBackend();
    if (el) el.disabled = false;
}

// levantar manual (botão)
async function manualWithdraw() {
    const addr = document.getElementById("withdrawAddress")?.value || "";
    const amtStr = document.getElementById("withdrawAmount")?.value || "0";
    const amt = parseFloat(amtStr);
    const msgEl = document.getElementById("withdrawMsg");
    if (!msgEl) return;

    if (!addr || !amt || amt <= 0) {
        msgEl.textContent = "Preencha todos os campos corretamente.";
        return;
    }
    if (amt > doge) {
        msgEl.textContent = "Saldo insuficiente.";
        return;
    }

    // atualizar local saldo e persistir (optimistic)
    doge -= amt;
    persistLocalState();
    render();

    const res = await sendWithdrawRequest(addr, amt);
    if (res.ok) {
        msgEl.textContent = res.message || "Pedido registado.";
    } else if (res.queued) {
        msgEl.textContent = "Offline — pedido enfileirado e será processado quando online.";
    } else {
        msgEl.textContent = "Erro: " + (res.message || "tente novamente");
        // se falhou sem enfileirar, devolve o saldo local
        // (aqui assumimos que o backend não processou nada)
        // Recarregar estado do backend pode ser necessário; neste momento fazemos rollback local:
        // (opcional) rollback
        // doge += amt; persistLocalState(); render();
    }
}

// --- Inicialização DOMContentLoaded ---
document.addEventListener("DOMContentLoaded", () => {
    // Render inicial
    render();

    // mostrar a tela correta dependendo do login
    if (loggedIn) {
        if (document.getElementById("loginBox")) document.getElementById("loginBox").style.display = "none";
        if (document.getElementById("appBox")) document.getElementById("appBox").style.display = "block";
    } else {
        if (document.getElementById("loginBox")) document.getElementById("loginBox").style.display = "block";
        if (document.getElementById("appBox")) document.getElementById("appBox").style.display = "none";
    }

    // ligar botões
    const addBtn = document.getElementById("addStep");
    if (addBtn) addBtn.addEventListener("click", addStepLocalAndSync);

    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) loginBtn.addEventListener("click", login);

    const genWalletBtn = document.getElementById("generateWalletBtn");
    if (genWalletBtn) genWalletBtn.addEventListener("click", onGenerateWalletClicked);

    const withdrawBtn = document.getElementById("withdrawBtn");
    if (withdrawBtn) withdrawBtn.addEventListener("click", manualWithdraw);

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);

    // inicia flush loop
    startOutboxFlushLoop();

    // opcional: sincroniza saldo inicial do backend uma vez ao carregar (se online)
    (async () => {
        if (!navigator.onLine) return;
        try {
            const res = await fetch(`${API_URL}/api/status`, { method: "GET" });
            if (res.ok) {
                const json = await res.json();
                if (json.steps != null) steps = parseInt(json.steps);
                if (json.doge != null) doge = parseInt(json.doge);
                if (json.wallet) wallet = json.wallet;
                persistLocalState();
                render();
            }
        } catch (err) {
            console.warn("Inicial sync falhou:", err);
        }
    })();
});

// --- Serviço adicional: auto-conversão (ex.: TRX/DOGE) ---
// Se quiseres converter passos para TRX/DOGE via backend,
// podes chamar: GET /api/convert?steps=NUM ou POST { steps }
// Implementação de exemplo (deixa comentada se não usado)
async function requestConversionPreview(stepsToConvert) {
    try {
        const res = await fetch(`${API_URL}/api/convert?steps=${encodeURIComponent(stepsToConvert)}`);
        if (!res.ok) return null;
        const json = await res.json();
        return json; // { dogeEquivalent: X, trxEquivalent: Y, rate: {...} }
    } catch (err) {
        console.warn("requestConversionPreview erro:", err);
        return null;
    }
