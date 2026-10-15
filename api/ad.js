export default async function handler(req, res) {
  // El token se lee de forma segura desde el servidor
  const secretToken = process.env.AD_SECRET_TOKEN;
  
  // Aquí puedes realizar la llamada protegida a tu proveedor de anuncios
  // usando el token privado sin exponerlo al usuario.
  
  return res.status(200).json({
    content: "<div class='ad-secure'>Anuncio Protegido Oficial</div>",
    status: "active"
  });
}
