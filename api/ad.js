// api/ad.js
export default function handler(req, res) {
    // El token secreto se almacena en las variables de entorno de Vercel (Settings -> Environment Variables)
    const secretToken = process.env.AD_SECRET_TOKEN || "token_por_defecto_seguro";

    // Aquí puedes realizar validaciones internas con tu token o llamadas a tu proveedor de publicidad
    const isAuthorized = secretToken !== "";

    if (!isAuthorized) {
        return res.status(401).json({ error: "Acceso no autorizado al bloque de anuncios" });
    }

    // Código cerrado/protegido que se enviará al cliente de forma segura
    const protectedAdHTML = `
        <div class="ad-placeholder">
            <span class="ad-tag">AD [PROPIETARIO / PROTEGIDO]</span>
            <p>Banner publicitario oficial gestionado desde el servidor seguro.</p>
        </div>
    `;

    // Devolvemos el resultado en formato JSON
    return res.status(200).json({
        success: true,
        content: protectedAdHTML
    });
}
