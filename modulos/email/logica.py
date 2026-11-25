"""
Envio del email semanal (diseno_informatico.md 8): cuerpo con el resumen
ejecutivo (HTML y texto plano) y el HTML de detalle adjunto.

SMTP con STARTTLS y las credenciales del bloque 'email' del fichero de
secretos (las mismas que bolsa); destinatarios del bloque opcional
'finvizanalysis' si existe. Estructura MIME: multipart/mixed ->
[multipart/alternative (texto, HTML), adjunto text/html en base64].
"""
import logging
import smtplib
import ssl
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

logger = logging.getLogger(__name__)


def motivo_para_no_enviar(config) -> str | None:
    """None si se puede enviar; si no, el motivo."""
    conf = config.credenciales_email
    if not config.get("email.activar", True):
        return "email.activar=false en configuracion.yml"
    if not conf.get("activar", True):
        return "email.activar=false en el fichero de secretos"
    if not conf.get("destinatarios"):
        return "sin destinatarios en el fichero de secretos"
    if not conf.get("usuario") or not conf.get("password"):
        return "faltan credenciales SMTP en el fichero de secretos"
    return None


def construir_mensaje(remitente: str, destinatarios: list, asunto: str, texto: str, html: str,
                      adjuntos: dict) -> MIMEMultipart:
    """adjuntos: {nombre_fichero: bytes} (HTML)."""
    mensaje = MIMEMultipart("mixed")
    mensaje["From"] = remitente
    mensaje["To"] = ", ".join(destinatarios)
    mensaje["Subject"] = asunto
    mensaje["Date"] = formatdate(localtime=True)
    mensaje["Message-ID"] = make_msgid(domain="finvizanalysis.local")
    cuerpo = MIMEMultipart("alternative")
    cuerpo.attach(MIMEText(texto, "plain", "utf-8"))
    cuerpo.attach(MIMEText(html, "html", "utf-8"))
    mensaje.attach(cuerpo)
    for nombre, contenido in adjuntos.items():
        parte = MIMEBase("text", "html")
        parte.set_payload(contenido)
        encoders.encode_base64(parte)
        parte.add_header("Content-Disposition", "attachment", filename=nombre)
        mensaje.attach(parte)
    return mensaje


def enviar(config, asunto: str, texto: str, html: str, adjuntos: dict | None = None) -> str:
    """Envia el email. Devuelve 'enviado' o el motivo de no enviarlo. Lanza la excepcion de SMTP."""
    motivo = motivo_para_no_enviar(config)
    if motivo:
        logger.warning("Email no enviado: %s", motivo)
        return motivo
    conf = config.credenciales_email
    mensaje = construir_mensaje(conf["usuario"], conf["destinatarios"], asunto, texto, html, adjuntos or {})
    with smtplib.SMTP(conf.get("smtp_host", "smtp.gmail.com"), int(conf.get("smtp_port", 587)), timeout=60) as s:
        s.ehlo()
        s.starttls(context=ssl.create_default_context())
        s.login(conf["usuario"], str(conf["password"]))
        s.send_message(mensaje)
    logger.info("Email enviado a %d destinatarios", len(conf["destinatarios"]))
    return "enviado"
