// app.js corregido y actualizado
const chatsData = [
    {
        id: 1,
        name: "FPE",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
        preview: "*Plays funny track...* Hola, ¿qué tal?",
        time: "14:14",
        messages: [
            { sender: "ai", text: "*Plays funny track...* Hola, ¿qué tal?" },
            { sender: "user", text: "Hola **FPE**, todo bien por aquí." },
            { sender: "ai", text: "Me alegra **mucho** escuchar eso. ¿En qué te *puedo ayudar* hoy?" }
        ]
    },
    {
        id: 2,
        name: "MHA FUTURE GEN",
        avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
        preview: "**With the defeat of All For One, Tomura Shigaraki...**",
        time: "Ayer",
        messages: [
            { sender: "ai", text: "**With the defeat of All For One, Tomura Shigaraki** ha desaparecido." },
            { sender: "user", text: "¿Cuál es el *siguiente paso* en la academia?" }
        ]
    }
];

let currentChatId = null;

document.addEventListener("DOMContentLoaded", () => {
    renderChatList();
    setupNavigation();
    setupChatInteractions();
    loadSecureAd(); // Carga el anuncio protegido al iniciar la app
});

function renderChatList() {
    const chatListEl = document.getElementById("chatList");
    chatListEl.innerHTML = "";
    
    chatsData.forEach(chat => {
        const item = document.createElement("div");
        item.className = "chat-item";
        item.onclick = () => openChat(chat.id);
        
        item.innerHTML = `
            <img src="${chat.avatar}" alt="${chat.name}" class="avatar-md">
            <div class="chat-info">
                <h4>${chat.name}</h4>
                <p>${formatTextPreview(chat.preview)}</p>
            </div>
            <span class="chat-meta">${chat.time}</span>
        `;
        chatListEl.appendChild(item);
    });
}

function formatTextPreview(text) {
    return text.replace(/\*\*(.*?)\*\*/g, '\$1').replace(/\*(.*?)\*/g, '\$1');
}

function formatMessageText(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>\$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>\$1</em>');
}

// Función para cargar el anuncio protegido desde la Serverless Function (/api/ad)
async function loadSecureAd() {
    const adContainer = document.getElementById("adContainer");
    if (!adContainer) return;

    try {
        const response = await fetch('/api/ad');
        if (!response.ok) throw new Error("Error al conectar con el servidor de anuncios");
        
        const data = await response.json();
        if (data.success && data.content) {
            adContainer.innerHTML = data.content;
        }
    } catch (error) {
        console.error("No se pudo cargar el bloque de anuncios protegido:", error);
        adContainer.innerHTML = `<div class="ad-placeholder"><p style="font-size:11px; color:#777;">Publicidad no disponible temporalmente</p></div>`;
    }
}

function openChat(chatId) {
    currentChatId = chatId;
    const chat = chatsData.find(c => c.id === chatId);
    if (!chat) return;

    document.getElementById("currentName").innerText = chat.name;
    document.getElementById("currentAvatar").src = chat.avatar;

    document.getElementById("homeView").classList.remove("active");
    document.getElementById("exploreView").classList.remove("active");
    document.getElementById("profileView").classList.remove("active");
    document.getElementById("chatView").style.display = "flex";
    document.getElementById("chatView").classList.add("active");

    renderMessages(chat.messages);
}

function renderMessages(messages) {
    const container = document.getElementById("chatMessages");
    container.innerHTML = "";

    messages.forEach(msg => {
        const msgEl = document.createElement("div");
        msgEl.className = `message ${msg.sender}`;
        msgEl.innerHTML = formatMessageText(msg.text);
        container.appendChild(msgEl);
    });

    container.scrollTop = container.scrollHeight;
}

function setupChatInteractions() {
    const backBtn = document.getElementById("backBtn");
    backBtn.onclick = () => {
        document.getElementById("chatView").style.display = "none";
        document.getElementById("chatView").classList.remove("active");
        document.getElementById("homeView").classList.add("active");
        currentChatId = null;
    };

    const sendBtn = document.getElementById("sendBtn");
    const messageInput = document.getElementById("messageInput");

    const handleSend = () => {
        const text = messageInput.value.trim();
        if (!text || currentChatId === null) return;

        const chat = chatsData.find(c => c.id === currentChatId);
        if (!chat) return;

        chat.messages.push({ sender: "user", text });
        messageInput.value = "";
        renderMessages(chat.messages);

        setTimeout(() => {
            chat.messages.push({ 
                sender: "ai", 
                text: `Entendido. Dijiste: *"${text}"*. ¿Hay algo más en lo que te *pueda ayudar* hoy?` 
            });
            renderMessages(chat.messages);
        }, 1000);
    };

    sendBtn.onclick = handleSend;
    messageInput.onkeypress = (e) => {
        if (e.key === "Enter") handleSend();
    };
}

function setupNavigation() {
    const navItems = document.querySelectorAll(".bottom-nav .nav-item");
    navItems.forEach(item => {
        const target = item.getAttribute("data-target");
        if (!target) return;

        item.onclick = () => {
            navItems.forEach(nav => nav.classList.remove("active"));
            item.classList.add("active");

            document.getElementById("homeView").classList.remove("active");
            document.getElementById("chatView").style.display = "none";
            document.getElementById("chatView").classList.remove("active");
            document.getElementById("exploreView").classList.remove("active");
            document.getElementById("profileView").classList.remove("active");

            if (target === "homeView" || target === "chatListTab") {
                document.getElementById("homeView").classList.add("active");
            } else if (target === "exploreView") {
                document.getElementById("exploreView").classList.add("active");
            } else if (target === "profileView") {
                document.getElementById("profileView").classList.add("active");
            } else if (target === "createView") {
                alert("Crear nuevo personaje / chat (Próximamente)");
            }
        };
    });
}
