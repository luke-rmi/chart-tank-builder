// Rex + Chart Builder hybrid · chat-builder.js
// Drives rex-chart-demo.html — the Rex chat + Chart Tank Builder integration.
// Sends mode:"chart_builder" with every API call so Rex can invoke show_tank_selector.
// DO NOT use this file on the standard askrex.com chat pages.

(function () {
  "use strict";

  // ── Config ──────────────────────────────────────────────────────────────────
  const API_BASE = "https://wxyvuroiybqjqdleuijp.supabase.co/functions/v1";
  const FEEDBACK_AFTER_TURNS = 5;
  // chart-data.json is served from the same origin (GitHub Pages)
  const DATA_URL = "chart-data.json?v=" + (Date.now() % 1000000);

  // ── State ───────────────────────────────────────────────────────────────────
  let CHART_DATA = null;
  let conversationId = null;
  let isSending = false;
  let isEscalated = false;
  let pendingFiles = [];
  let displayedMessageCount = 0;
  let pollInterval = null;
  let rexTurnCount = 0;
  let feedbackShown = false;
  let escalationButtonEl = null;

  // Builder state — accumulates as Rex guides the user through configuration
  const builderState = {
    tank: null,      // full tank object once selected
    gasType: null,   // gas type string if Rex confirms it
    selections: [],  // [{label, value}] from Rex-confirmed choices
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const chatLogEl   = document.getElementById("chat-log");
  const inputEl     = document.getElementById("chat-input");
  const sendBtn     = document.getElementById("chat-send");
  const attachBtn   = document.getElementById("chat-attach");
  const fileInput   = document.getElementById("chat-file");
  const previewBar  = document.getElementById("image-preview-bar");
  const chatEl      = document.getElementById("rex-chat");

  // Builder panel DOM refs
  const cbHeroEl    = document.getElementById("cb-hero");
  const cbSubEl     = document.getElementById("cb-sub");
  const cbBodyEl    = document.getElementById("cb-body");
  const cbActionsEl = document.getElementById("cb-actions");

  // ── Load chart data ─────────────────────────────────────────────────────────
  async function loadChartData() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      CHART_DATA = await res.json();
    } catch (err) {
      console.warn("chat-builder: could not load chart-data.json —", err.message);
      // Non-fatal: cards just won't render if tank IDs can't be looked up
    }
  }

  // ── Image compression ───────────────────────────────────────────────────────
  function compressImage(file) {
    return new Promise(function (resolve) {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width >= height) { height = Math.round((height * MAX) / width); width = MAX; }
          else { width = Math.round((width * MAX) / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(resolve, "image/jpeg", 0.85);
      };
      img.src = objectUrl;
    });
  }

  // ── Preview bar ─────────────────────────────────────────────────────────────
  function refreshPreviewBar() {
    previewBar.innerHTML = "";
    if (pendingFiles.length === 0) { previewBar.style.display = "none"; return; }
    previewBar.style.display = "flex";
    pendingFiles.forEach(function (file, index) {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:relative;display:inline-block;";
      const thumb = document.createElement("img");
      thumb.src = URL.createObjectURL(file);
      thumb.style.cssText = "width:56px;height:56px;object-fit:cover;border-radius:6px;display:block;";
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "×";
      removeBtn.style.cssText =
        "position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#002832;color:#fff;border:none;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;";
      removeBtn.addEventListener("click", function () {
        URL.revokeObjectURL(thumb.src);
        pendingFiles.splice(index, 1);
        refreshPreviewBar();
      });
      wrapper.appendChild(thumb);
      wrapper.appendChild(removeBtn);
      previewBar.appendChild(wrapper);
    });
  }

  attachBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    const newFiles = Array.from(fileInput.files || []);
    const remaining = 5 - pendingFiles.length;
    if (newFiles.length > remaining) alert("Maximum 5 images per message.");
    pendingFiles = pendingFiles.concat(newFiles.slice(0, remaining));
    fileInput.value = "";
    refreshPreviewBar();
  });

  // ── Link extraction ─────────────────────────────────────────────────────────
  function extractLinks(text) {
    const links = [], seen = new Set();
    const mdPat = /\[([^\]]+)\]\((https:\/\/[^)]+)\)/g;
    let m;
    while ((m = mdPat.exec(text)) !== null) {
      if (!seen.has(m[2])) { seen.add(m[2]); links.push({ title: m[1].trim(), url: m[2].trim() }); }
    }
    const plainPat = /https:\/\/\S+/g;
    while ((m = plainPat.exec(text)) !== null) {
      const url = m[0].replace(/[.,;!?)]+$/, "");
      if (!seen.has(url)) { seen.add(url); links.push({ title: null, url }); }
    }
    return links;
  }

  // ── Link card bubble ────────────────────────────────────────────────────────
  function addLinkBubble(title, url) {
    const bubble = document.createElement("div");
    bubble.style.cssText = "margin-bottom:12px;display:flex;justify-content:flex-start;";
    const card = document.createElement("a");
    card.href = url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.className = "rex-link-card";
    card.textContent = "CLICK HERE: 🔗 " + (title || "View Resource");
    bubble.appendChild(card);
    chatLogEl.appendChild(bubble);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  // ── Message bubbles ─────────────────────────────────────────────────────────
  function addMessageBubble(sender, text, imageUrls) {
    const bubble = document.createElement("div");
    bubble.style.marginBottom = "12px";
    bubble.style.display = "flex";
    const inner = document.createElement("div");
    inner.style.padding = "10px 12px";
    inner.style.maxWidth = "82%";
    inner.style.fontSize = "16px";
    inner.style.lineHeight = "1.45";
    inner.style.wordBreak = "break-word";

    if (sender === "user") {
      bubble.style.justifyContent = "flex-end";
      inner.style.background = "#002832";
      inner.style.color = "#fff";
      inner.style.borderRadius = "10px";
      if (imageUrls && imageUrls.length > 0) {
        const imgGrid = document.createElement("div");
        imgGrid.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:" + (text ? "8px" : "0") + ";";
        imageUrls.forEach(function (url) {
          const img = document.createElement("img");
          img.src = url;
          img.style.cssText = "width:80px;height:80px;object-fit:cover;border-radius:4px;";
          imgGrid.appendChild(img);
        });
        inner.appendChild(imgGrid);
      }
      if (text) {
        const textNode = document.createElement("div");
        textNode.style.whiteSpace = "pre-wrap";
        textNode.textContent = text;
        inner.appendChild(textNode);
      }
    } else if (sender === "rep") {
      bubble.style.justifyContent = "flex-start";
      inner.style.background = "#4a4a4a";
      inner.style.color = "#fff";
      inner.style.borderRadius = "10px";
      inner.style.whiteSpace = "pre-wrap";
      inner.textContent = text;
    } else {
      // Rex
      bubble.style.justifyContent = "flex-start";
      inner.style.background = "#0DB5F0";
      inner.style.color = "#fff";
      inner.style.borderRadius = "10px";
      inner.style.whiteSpace = "pre-wrap";
      inner.textContent = text;
    }
    bubble.appendChild(inner);
    chatLogEl.appendChild(bubble);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    return bubble;
  }

  // ── Thinking bubble ─────────────────────────────────────────────────────────
  function showThinkingBubble() {
    const bubble = document.createElement("div");
    bubble.style.marginBottom = "12px";
    bubble.style.display = "flex";
    bubble.style.justifyContent = "flex-start";
    const inner = document.createElement("div");
    inner.className = "rex-bubble";
    bubble.classList.add("rex-thinking");
    inner.innerHTML = '<span class="rex-dot"></span><span class="rex-dot"></span><span class="rex-dot"></span>';
    bubble.appendChild(inner);
    chatLogEl.appendChild(bubble);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    return function () { bubble.remove(); };
  }

  // ── Toast ────────────────────────────────────────────────────────────────────
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  // ── Tank selector cards ──────────────────────────────────────────────────────
  function addTankSelectorCards(tankSelector) {
    if (!tankSelector || !tankSelector.candidates || !tankSelector.candidates.length) return;

    const tanks = tankSelector.candidates
      .map(function (id) {
        return CHART_DATA && CHART_DATA.tanks
          ? CHART_DATA.tanks.find(function (t) { return t.id === id; })
          : null;
      })
      .filter(Boolean);

    if (tanks.length === 0) {
      // CHART_DATA not loaded yet or bad IDs — fall through gracefully
      console.warn("chat-builder: tank_selector candidates not found in chart-data:", tankSelector.candidates);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "rcd-card-strip";

    if (tankSelector.prompt) {
      const promptEl = document.createElement("p");
      promptEl.className = "rcd-card-prompt";
      promptEl.textContent = tankSelector.prompt;
      wrapper.appendChild(promptEl);
    }

    const grid = document.createElement("div");
    grid.className = "rcd-card-grid";

    tanks.forEach(function (tank) {
      const card = document.createElement("button");
      card.className = "rcd-tank-card";
      card.type = "button";

      // Fill type human label
      const fillLabel = tank.fillType === "TopFill" ? "Top Fill"
                      : tank.fillType === "FlexFill" ? "FlexFill"
                      : (tank.fillType || "");

      // Build tag badges
      const tagHTML = [
        tank.pressureClass && `<span class="rcd-card-spec-tag">${tank.pressureClass}</span>`,
        tank.psiRating     && `<span class="rcd-card-spec-tag">${tank.psiRating}</span>`,
        fillLabel          && `<span class="rcd-card-spec-tag">${fillLabel}</span>`,
        tank.standard      && `<span class="rcd-card-spec-tag">${tank.standard}</span>`,
      ].filter(Boolean).join("");

      card.innerHTML =
        '<div class="rcd-card-img-wrap">' +
          '<img class="rcd-card-img" src="' + tank.heroImage + '" alt="' + tank.displayName + '" loading="lazy" />' +
        '</div>' +
        '<div class="rcd-card-info">' +
          '<div class="rcd-card-name">' + tank.displayName + '</div>' +
          '<div class="rcd-card-specs">' + tagHTML + '</div>' +
        '</div>' +
        '<div class="rcd-card-select">Select →</div>';

      card.addEventListener("click", function () {
        if (card.disabled) return;

        // Mark selected, disable all cards in this strip
        grid.querySelectorAll(".rcd-tank-card").forEach(function (c) {
          c.classList.remove("selected");
          c.disabled = true;
        });
        card.classList.add("selected");

        // Update builder state
        builderState.tank = tank;
        updateBuilderPanel();

        // Fire selection to Rex as a normal user message
        sendText("I’d like the " + tank.displayName);
      });

      grid.appendChild(card);
    });

    wrapper.appendChild(grid);
    chatLogEl.appendChild(wrapper);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  // ── Builder panel ────────────────────────────────────────────────────────────
  function updateBuilderPanel() {
    if (!builderState.tank) return;
    const tank = builderState.tank;

    // Show the panel the first time a tank is selected
    const panelCol = document.getElementById("rcd-panel-col");
    if (panelCol && !panelCol.classList.contains("rcd-panel-visible")) {
      panelCol.classList.add("rcd-panel-visible");
    }

    // Hero image
    if (cbHeroEl) {
      cbHeroEl.innerHTML =
        '<img src="' + tank.heroImage + '" alt="' + tank.displayName +
        '" style="width:100%;height:100%;object-fit:contain;" />';
    }

    // Sub-title
    if (cbSubEl) cbSubEl.textContent = tank.displayName;

    // Body — show known config details
    if (cbBodyEl) {
      const fillLabel = tank.fillType === "TopFill" ? "Top Fill"
                      : tank.fillType === "FlexFill" ? "FlexFill"
                      : (tank.fillType || "—");

      let rows = [
        { label: "Tank",       value: tank.displayName },
        { label: "Pressure",   value: (tank.pressureClass || "—") + " · " + (tank.psiRating || "—") },
        { label: "Fill Type",  value: fillLabel },
      ];
      if (tank.standard) rows.push({ label: "Standard", value: tank.standard });

      // Append any extra selections Rex has confirmed
      builderState.selections.forEach(function (sel) {
        rows.push({ label: sel.label, value: sel.value });
      });

      cbBodyEl.innerHTML = rows.map(function (r) {
        return '<div class="sum-item" style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);">' +
          '<div class="lbl" style="flex:1;font-size:13px;color:var(--ink-soft);">' + r.label + '</div>' +
          '<div style="font-size:13px;font-weight:600;color:var(--ink);text-align:right;">' + r.value + '</div>' +
          '</div>';
      }).join("");
    }

    // Show action buttons
    if (cbActionsEl) cbActionsEl.style.display = "flex";
  }

  // ── Feedback widget ──────────────────────────────────────────────────────────
  function showFeedbackWidget() {
    if (feedbackShown) return;
    feedbackShown = true;
    const wrapper = document.createElement("div");
    wrapper.className = "rex-feedback";
    const label = document.createElement("span");
    label.textContent = "How is Rex doing so far?";
    const upBtn = document.createElement("button");
    upBtn.className = "rex-feedback-btn"; upBtn.title = "Yes"; upBtn.textContent = "👍";
    const downBtn = document.createElement("button");
    downBtn.className = "rex-feedback-btn"; downBtn.title = "No"; downBtn.textContent = "👎";
    async function submitFeedback(rating) {
      upBtn.disabled = true; downBtn.disabled = true;
      upBtn.classList.toggle("selected-up", rating === "up");
      downBtn.classList.toggle("selected-down", rating === "down");
      try {
        await fetch(API_BASE + "/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId, rating }),
        });
      } catch (err) { console.error("Feedback error:", err); }
      label.textContent = "Thanks for your feedback!";
      wrapper.removeChild(upBtn); wrapper.removeChild(downBtn);
    }
    upBtn.addEventListener("click", function () { submitFeedback("up"); });
    downBtn.addEventListener("click", function () { submitFeedback("down"); });
    wrapper.appendChild(label); wrapper.appendChild(upBtn); wrapper.appendChild(downBtn);
    chatLogEl.appendChild(wrapper);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  // ── Escalation button ────────────────────────────────────────────────────────
  function showEscalationButton(escalation) {
    removeEscalationButton();
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;justify-content:flex-start;margin-bottom:12px;";
    const btn = document.createElement("button");
    btn.textContent = "Connect to Rep";
    btn.style.cssText =
      "background:#002832;color:#fff;border:none;border-radius:20px;padding:10px 20px;font-size:16px;cursor:pointer;font-family:inherit;";
    btn.addEventListener("click", async function () {
      btn.disabled = true; btn.textContent = "Connecting...";
      try {
        const resp = await fetch(API_BASE + "/escalate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            reason: escalation.reason,
            urgency: escalation.urgency,
          }),
        });
        if (!resp.ok) throw new Error("escalate failed: " + resp.status);
        isEscalated = true;
        removeEscalationButton();
        addMessageBubble("assistant", "You’re now connected with a Ratermann rep. They’ll be with you shortly.");
        startPolling();
      } catch (err) {
        console.error("Escalation error:", err);
        btn.disabled = false; btn.textContent = "Connect to Rep";
      }
    });
    wrapper.appendChild(btn);
    chatLogEl.appendChild(wrapper);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    escalationButtonEl = wrapper;
  }

  function removeEscalationButton() {
    if (escalationButtonEl) { escalationButtonEl.remove(); escalationButtonEl = null; }
  }

  // ── Polling for rep replies ──────────────────────────────────────────────────
  function startPolling() {
    if (pollInterval || !conversationId) return;
    pollInterval = setInterval(async function () {
      try {
        const resp = await fetch(
          API_BASE + "/messages?conversation_id=" + conversationId + "&since=" + displayedMessageCount
        );
        if (!resp.ok) return;
        const data = await resp.json();
        for (const msg of (data.messages || [])) {
          addMessageBubble("rep", msg.content);
          displayedMessageCount++;
        }
      } catch (err) { console.error("Poll error:", err); }
    }, 4000);
  }

  // ── Send state ───────────────────────────────────────────────────────────────
  function setSendingState(sending) {
    isSending = sending;
    attachBtn.disabled = sending;
    const micBtn = document.getElementById("chat-mic");
    if (micBtn) micBtn.disabled = sending;
    if (sending) {
      sendBtn.disabled = true; sendBtn.style.opacity = "0.6"; sendBtn.textContent = "…";
    } else {
      sendBtn.disabled = false; sendBtn.style.opacity = "1"; sendBtn.textContent = "";
    }
  }

  // ── Upload images ────────────────────────────────────────────────────────────
  async function uploadImages(files) {
    const form = new FormData();
    for (const file of files) {
      const compressed = await compressImage(file);
      const name = file.name.replace(/\.[^.]+$/, ".jpg");
      form.append("images", compressed, name);
    }
    const resp = await fetch(API_BASE + "/upload", { method: "POST", body: form });
    if (!resp.ok) throw new Error("Image upload failed: " + resp.status);
    const data = await resp.json();
    return data.urls;
  }

  // ── API call — always sends mode:"chart_builder" ────────────────────────────
  async function callChatAPI(message, imageUrls) {
    const body = {
      mode: "chart_builder",  // ← The key addition — enables show_tank_selector tool
      ...(conversationId ? { conversation_id: conversationId } : {}),
    };
    if (message) body.message = message;
    if (imageUrls && imageUrls.length > 0) body.images = imageUrls;

    // Include stored contact info on first message
    if (!conversationId) {
      try {
        const stored = localStorage.getItem("rex_contact_info");
        if (stored) body.contact_info = JSON.parse(stored);
      } catch (_) {}
    }

    const resp = await fetch(API_BASE + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error("chat failed: " + resp.status);
    return await resp.json();
  }

  // ── Core send ────────────────────────────────────────────────────────────────
  async function sendText(text, preUploadedImageUrls) {
    if (isSending) return;
    const userText = (text || "").trim();
    const filesToSend = preUploadedImageUrls ? [] : pendingFiles.slice();
    if (!userText && filesToSend.length === 0 && !(preUploadedImageUrls && preUploadedImageUrls.length)) return;

    removeEscalationButton();
    pendingFiles = [];
    refreshPreviewBar();

    const displayUrls = preUploadedImageUrls || filesToSend.map(function (f) { return URL.createObjectURL(f); });
    addMessageBubble("user", userText || null, displayUrls);
    displayedMessageCount++;

    if (isEscalated) {
      setSendingState(true);
      try {
        let imageUrls = preUploadedImageUrls || [];
        if (filesToSend.length > 0) imageUrls = await uploadImages(filesToSend);
        await callChatAPI(userText || undefined, imageUrls.length > 0 ? imageUrls : undefined);
      } catch (err) {
        console.error("Chat error:", err);
        addMessageBubble("assistant", "Sorry, something went wrong. " + err);
      } finally {
        setSendingState(false);
        inputEl.focus();
      }
      return;
    }

    const stopThinking = showThinkingBubble();
    setSendingState(true);

    try {
      let imageUrls = preUploadedImageUrls || [];
      if (filesToSend.length > 0) imageUrls = await uploadImages(filesToSend);
      const data = await callChatAPI(userText || undefined, imageUrls.length > 0 ? imageUrls : undefined);
      stopThinking();

      if (data.conversation_id) conversationId = data.conversation_id;

      // Persist contact info
      if (data.contact_info) {
        try { localStorage.setItem("rex_contact_info", JSON.stringify(data.contact_info)); } catch (_) {}
      }

      if (data.status === "escalated") {
        isEscalated = true;
        startPolling();
        return;
      }

      // ── Render Rex's text reply
      if (data.reply) {
        const parts = data.reply.split("---RESOURCES---");
        const replyText = parts[0].trim();
        const resourceBlock = parts[1] || "";
        if (replyText) addMessageBubble("assistant", replyText);
        displayedMessageCount++;
        rexTurnCount++;
        extractLinks(resourceBlock).forEach(function (link) {
          addLinkBubble(link.title, link.url);
        });
        if (rexTurnCount >= FEEDBACK_AFTER_TURNS) showFeedbackWidget();
      }

      // ── Render tank selector cards (the core hybrid feature)
      if (data.tank_selector) {
        addTankSelectorCards(data.tank_selector);
      }

      if (data.escalation_pending) {
        showEscalationButton(data.escalation);
      }
    } catch (err) {
      console.error("Chat error:", err);
      stopThinking();
      addMessageBubble("assistant", "Sorry, something went wrong. " + err);
    } finally {
      setSendingState(false);
      inputEl.focus();
    }
  }

  // ── PDF export ───────────────────────────────────────────────────────────────
  function downloadPDF() {
    if (typeof window.jspdf === "undefined") {
      showToast("PDF library not loaded yet — try again in a moment.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const tank = builderState.tank;
    if (!tank) { showToast("No tank selected yet."); return; }

    const marginL = 20, marginT = 20, pageW = 216;
    let y = marginT;

    // Header bar
    doc.setFillColor(0, 40, 50);
    doc.rect(0, 0, pageW, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text("RATERMANN MANUFACTURING  ·  CHART MICROBULK CONFIGURATION", marginL, 9.5);

    y = 24;
    doc.setTextColor(26, 35, 48);

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Tank Configuration Summary", marginL, y);
    y += 8;

    // Subtitle
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 110, 120);
    doc.text("Rex-guided configuration · askrex.com/rex-chart-demo", marginL, y);
    y += 10;

    // Divider
    doc.setDrawColor(220, 225, 235);
    doc.line(marginL, y, pageW - marginL, y);
    y += 8;

    // Tank info section
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(26, 35, 48);
    doc.text("Selected Tank", marginL, y);
    y += 7;

    const rows = [
      ["Tank Model",    tank.displayName],
      ["Pressure Class", (tank.pressureClass || "—") + "  ·  " + (tank.psiRating || "—")],
      ["Fill Type",     tank.fillType === "TopFill" ? "Top Fill" : tank.fillType === "FlexFill" ? "FlexFill" : (tank.fillType || "—")],
      ["Certification", tank.standard || "—"],
    ];
    builderState.selections.forEach(function (sel) {
      rows.push([sel.label, sel.value]);
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    rows.forEach(function (row) {
      doc.setTextColor(100, 110, 120);
      doc.text(row[0], marginL, y);
      doc.setTextColor(26, 35, 48);
      doc.setFont("helvetica", "bold");
      doc.text(row[1], marginL + 52, y);
      doc.setFont("helvetica", "normal");
      y += 7;
    });

    y += 6;
    doc.setDrawColor(220, 225, 235);
    doc.line(marginL, y, pageW - marginL, y);
    y += 10;

    // Note
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(130, 140, 150);
    doc.text(
      "Configuration guided by Rex, the Ratermann AI agent. Confirm all part numbers with a Ratermann team member before ordering.",
      marginL, y, { maxWidth: pageW - marginL * 2 }
    );
    y += 12;

    // Footer contact
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 110, 120);
    doc.text("Ratermann Manufacturing, Inc.  ·  1-800-264-7793  ·  rmiorder.com", marginL, y);

    const filename = "ratermann-" + tank.id + "-config.pdf";
    doc.save(filename);
    showToast("PDF saved: " + filename);
  }

  // ── Contact Sales modal (simple prompt → email) ──────────────────────────────
  function handleContactSales() {
    // Scroll the chat to top and have Rex offer to connect
    sendText("I’d like to speak with a Ratermann sales rep about this configuration.");
  }

  // ── Wire up builder panel buttons ────────────────────────────────────────────
  const pdfBtn     = document.getElementById("cb-pdf-btn");
  const contactBtn = document.getElementById("cb-contact-btn");
  if (pdfBtn)     pdfBtn.addEventListener("click", downloadPDF);
  if (contactBtn) contactBtn.addEventListener("click", handleContactSales);

  // ── Voice input ──────────────────────────────────────────────────────────────
  (function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const micBtn = document.getElementById("chat-mic");
    if (!micBtn) return;
    let recognition = null, isRecording = false;

    function startRecognition() {
      const r = new SpeechRecognition();
      r.continuous = true; r.interimResults = false; r.lang = "en-US";
      r.onresult = function (e) {
        const transcript = Array.from(e.results).map(function (res) { return res[0].transcript; }).join(" ").trim();
        if (transcript) inputEl.value = inputEl.value ? inputEl.value + " " + transcript : transcript;
      };
      r.onerror = function (e) { if (e.error === "not-allowed") micBtn.style.display = "none"; stopRecognition(); };
      r.onend = function () { if (isRecording) setTimeout(function () { if (isRecording) startRecognition(); }, 50); };
      r.start(); recognition = r; isRecording = true; micBtn.classList.add("mic-recording");
    }
    function stopRecognition() {
      isRecording = false; micBtn.classList.remove("mic-recording");
      if (recognition) { recognition.stop(); recognition = null; }
    }
    micBtn.style.display = "flex";
    micBtn.addEventListener("click", function () {
      if (isSending) return;
      if (isRecording) stopRecognition(); else startRecognition();
    });
  })();

  // ── UI handlers ──────────────────────────────────────────────────────────────
  async function handleSend() {
    const txt = inputEl.value;
    inputEl.value = "";
    await sendText(txt);
  }

  sendBtn.addEventListener("click", handleSend);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // ── Drag and drop ────────────────────────────────────────────────────────────
  let dragDepth = 0;
  chatEl.addEventListener("dragenter", function (e) { e.preventDefault(); dragDepth++; chatEl.classList.add("drag-over"); });
  chatEl.addEventListener("dragover",  function (e) { e.preventDefault(); });
  chatEl.addEventListener("dragleave", function ()  { dragDepth--; if (dragDepth === 0) chatEl.classList.remove("drag-over"); });
  chatEl.addEventListener("drop", function (e) {
    e.preventDefault(); dragDepth = 0; chatEl.classList.remove("drag-over");
    if (isSending) return;
    const dropped = Array.from(e.dataTransfer.files).filter(function (f) {
      return f.type === "image/jpeg" || f.type === "image/png";
    });
    const remaining = 5 - pendingFiles.length;
    if (dropped.length > remaining) alert("Maximum 5 images per message.");
    pendingFiles = pendingFiles.concat(dropped.slice(0, remaining));
    refreshPreviewBar();
  });

  // ── Boot ─────────────────────────────────────────────────────────────────────
  (async function boot() {
    // Load chart data in parallel with the opening message
    loadChartData();

    const params = new URLSearchParams(window.location.search);
    let m = params.get("m");
    const imgUrls = params.getAll("img");
    if (typeof m === "string") m = m.replace(/\+/g, " ");
    const text = m ? m.trim() : "";

    if (text || imgUrls.length > 0) {
      await sendText(text, imgUrls.length > 0 ? imgUrls : undefined);
    } else {
      addMessageBubble(
        "assistant",
        "Just a demo, but check out how I can help you build a Chart tank! We won’t just piece it together, we are going to figure out exactly what your system requires. Where should we start?"
      );
    }
  })();
})();
