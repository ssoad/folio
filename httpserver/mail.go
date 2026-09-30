package main

// Account emails (address verification, password reset) through the SMTP
// server set in the admin panel. Port 465 uses TLS from the start; other
// ports upgrade with STARTTLS when the server offers it.

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

func mailConfigured() bool {
	return getSetting("smtp_host") != "" && getSetting("smtp_from") != ""
}

func sendMail(to, subject, body string) error {
	if !mailConfigured() {
		return errors.New("Email isn't set up on this server")
	}
	host, port := getSetting("smtp_host"), getSetting("smtp_port")
	from := getSetting("smtp_from")
	if strings.ContainsAny(to+subject, "\r\n") {
		return errors.New("Invalid email header")
	}
	message := strings.Join([]string{
		"From: " + from,
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("utf-8", subject),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
	}, "\r\n")
	address := net.JoinHostPort(host, port)
	var auth smtp.Auth
	if user := getSetting("smtp_username"); user != "" {
		auth = smtp.PlainAuth("", user, getSetting("smtp_password"), host)
	}
	// The envelope sender is the bare address from "Name <address>"
	sender := from
	if i, j := strings.LastIndex(from, "<"), strings.LastIndex(from, ">"); i >= 0 && j > i {
		sender = from[i+1 : j]
	}
	var err error
	if port == "465" {
		err = sendMailTLS(address, host, auth, sender, to, []byte(message))
	} else {
		err = smtp.SendMail(address, auth, sender, []string{to}, []byte(message))
	}
	if err != nil {
		log.Printf("[mail] Sending to %s failed: %v", to, err)
		return fmt.Errorf("Sending email failed: %w", err)
	}
	return nil
}

func sendMailTLS(address, host string, auth smtp.Auth, from, to string, message []byte) error {
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 20 * time.Second}, "tcp", address, &tls.Config{ServerName: host})
	if err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(message); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
