// Package mail stellt einen schlanken E-Mail-Versand über die Resend HTTP-API
// bereit (https://resend.com). Weitere Treiber (smtp, php-mail) sind in diesem
// Go-Port bewusst weggelassen – Resend ist der einzige produktive Treiber.
//
// Konfiguration via Umgebungsvariablen:
//
//	MAIL_DRIVER      – derzeit ignoriert, immer "resend"
//	RESEND_API_KEY   – Bearer-Token für api.resend.com
//	MAIL_FROM        – Absender-Adresse (z. B. no-reply@spin.point4studios.at)
//	MAIL_FROM_NAME   – Absender-Name   (z. B. "Point4 Spin")
//	MAIL_REPLY_TO    – optionale Reply-To-Adresse
package mail

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

// cfg hält die einmalig beim Paketstart eingelesene Konfiguration.
type cfg struct {
	apiKey   string
	from     string
	fromName string
	replyTo  string
}

func loadConfig() cfg {
	return cfg{
		apiKey:   os.Getenv("RESEND_API_KEY"),
		from:     getEnvDefault("MAIL_FROM", "no-reply@spin.point4studios.at"),
		fromName: getEnvDefault("MAIL_FROM_NAME", "Point4 Spin"),
		replyTo:  os.Getenv("MAIL_REPLY_TO"),
	}
}

func getEnvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// httpClient mit Timeout – kein globaler Default-Client.
var httpClient = &http.Client{Timeout: 15 * time.Second}

// resendPayload ist die Anfrage-Struktur für POST https://api.resend.com/emails.
type resendPayload struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text,omitempty"`
	ReplyTo string   `json:"reply_to,omitempty"`
}

// sendViaResend sendet eine E-Mail über die Resend REST-API.
func sendViaResend(c cfg, toEmail, subject, html, text string) error {
	if c.apiKey == "" {
		return errors.New("RESEND_API_KEY fehlt – E-Mail-Versand nicht möglich")
	}

	from := c.from
	if c.fromName != "" {
		from = c.fromName + " <" + c.from + ">"
	}

	payload := resendPayload{
		From:    from,
		To:      []string{toEmail},
		Subject: subject,
		HTML:    html,
		Text:    text,
		ReplyTo: c.replyTo,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("json marshal: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("request erstellen: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("resend verbindung fehlgeschlagen: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	var resBody struct {
		Message string `json:"message"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&resBody)
	msg := resBody.Message
	if msg == "" {
		msg = resp.Status
	}
	return fmt.Errorf("resend fehler (%d): %s", resp.StatusCode, msg)
}

// SendCredentials sendet die Zugangsdaten an einen neu angelegten Kunden-Admin.
// Gibt einen Fehler zurück wenn kein API-Key konfiguriert ist oder der HTTP-Call scheitert.
func SendCredentials(toEmail, toName, loginEmail, plainPassword string) error {
	c := loadConfig()
	subject := "Ihre Zugangsdaten für Point4 Spin"
	html := buildCredentialsHTML(toName, loginEmail, plainPassword)
	text := buildCredentialsText(toName, loginEmail, plainPassword)
	return sendViaResend(c, toEmail, subject, html, text)
}

// ─── E-Mail-Templates ─────────────────────────────────────────────────────────

// loginURL liefert die Anmelde-URL aus der Umgebung oder den Standardwert.
func loginURL() string {
	if u := os.Getenv("APP_URL"); u != "" {
		return u + "/#/login"
	}
	return "https://spin.point4studios.at/#/login"
}

func buildCredentialsHTML(toName, loginEmail, plainPassword string) string {
	url := loginURL()
	return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Ihre Point4 Spin Zugangsdaten</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Montserrat,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:40px;text-align:center;">
            <h1 style="color:#c9a05c;margin:0 0 8px;font-size:28px;font-weight:700;">Point4 Spin</h1>
            <p style="color:#94a3b8;margin:0;font-size:14px;">Ihre Zugangsdaten</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 24px;">Hallo ` + htmlEscape(toName) + `,</p>
            <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 32px;">
              Ihr Konto für das Point4 Spin Glücksrad wurde erfolgreich eingerichtet.
              Sie können sich mit folgenden Zugangsdaten anmelden:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#f8fafc;border-radius:12px;margin-bottom:32px;">
              <tr><td style="padding:20px;">
                <p style="margin:0 0 6px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">E-Mail-Adresse</p>
                <p style="margin:0 0 20px;color:#0f172a;font-size:18px;font-weight:700;">` + htmlEscape(loginEmail) + `</p>
                <p style="margin:0 0 6px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Passwort</p>
                <p style="margin:0;color:#0f172a;font-size:18px;font-weight:700;font-family:monospace;letter-spacing:.5px;">` + htmlEscape(plainPassword) + `</p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
              <tr><td align="center">
                <a href="` + htmlEscape(url) + `"
                   style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#c9a05c,#b08d4b);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">
                  Zum Login
                </a>
              </td></tr>
            </table>
            <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 16px;">
              Aus Sicherheitsgründen empfehlen wir Ihnen, das Passwort nach dem ersten Login zu ändern.
            </p>
            <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">
              Bei Fragen stehen wir Ihnen gerne unter
              <a href="mailto:office@point4studio.at" style="color:#c9a05c;">office@point4studio.at</a> zur Verfügung.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="color:#94a3b8;font-size:12px;margin:0;">© 2025 Point4 Studios. Alle Rechte vorbehalten.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

func buildCredentialsText(toName, loginEmail, plainPassword string) string {
	url := loginURL()
	return "Hallo " + toName + ",\n\n" +
		"Ihr Konto für das Point4 Spin Glücksrad wurde erfolgreich eingerichtet.\n\n" +
		"E-Mail-Adresse: " + loginEmail + "\n" +
		"Passwort:       " + plainPassword + "\n\n" +
		"Login-URL: " + url + "\n\n" +
		"Aus Sicherheitsgründen empfehlen wir Ihnen, das Passwort nach dem ersten Login zu ändern.\n\n" +
		"Bei Fragen: office@point4studio.at\n\n" +
		"© 2025 Point4 Studios"
}

// htmlEscape ersetzt die fünf HTML-Sonderzeichen.
func htmlEscape(s string) string {
	var buf bytes.Buffer
	for _, r := range s {
		switch r {
		case '&':
			buf.WriteString("&amp;")
		case '<':
			buf.WriteString("&lt;")
		case '>':
			buf.WriteString("&gt;")
		case '"':
			buf.WriteString("&#34;")
		case '\'':
			buf.WriteString("&#39;")
		default:
			buf.WriteRune(r)
		}
	}
	return buf.String()
}
