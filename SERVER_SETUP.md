# JS Studio: Server und Konten

## Lokal starten

Voraussetzungen: Node.js 20 oder neuer.

1. Im Ordner `Petter_wiederholung` Abhängigkeiten installieren: `npm install` (falls npm beim Sicherheitsdialog das native Paket `better-sqlite3` blockiert, dessen Installationsskript für dieses Projekt freigeben und anschließend erneut installieren)
2. Den Server starten: `npm start`
3. Im Browser `http://localhost:3000` öffnen. Die HTML-Dateien nicht direkt mit `file://` öffnen, denn Login und Server-Speicherung benötigen denselben Webserver.

Neue Konten benötigen eine gültig formatierte E-Mail-Adresse und ein Passwort mit mindestens 12 Zeichen. Die Nutzer-ID wird serverseitig erzeugt und im Konto angezeigt. Passwörter werden nicht im Klartext gespeichert: Der Server speichert nur einen individuellen Salt und einen scrypt-Hash.

Lernfortschritt und Sitzungen werden in `data/js-studio.sqlite` gespeichert. Die Datei wird nicht vom Webserver ausgeliefert und ist von Git ausgeschlossen.

## Vor einer öffentlichen Bereitstellung

- Setze `NODE_ENV=production` und `SESSION_SECRET` auf einen kryptografisch zufälligen Wert mit mindestens 32 Zeichen. Niemals den Beispielwert oder Secrets in Git speichern.
- Stelle die Anwendung ausschließlich über HTTPS hinter einem korrekt konfigurierten Reverse Proxy bereit. Der Produktionsmodus aktiviert Secure-Cookies und Proxy-Vertrauen.
- Verwende für `DATABASE_PATH` einen persistenten, gesicherten Datenträger. Flüchtige Dateisysteme bei Hosting-Diensten verlieren SQLite-Daten nach Neustarts oder Deployments.
- Sichere die SQLite-Datei regelmäßig und begrenze den Serverzugriff darauf. Für mehrere Server-Instanzen oder sehr viele Nutzer:innen sollte eine verwaltete Datenbank wie PostgreSQL mit gemeinsamem Session-Store verwendet werden.
- Dieses Grundgerüst bestätigt nicht, dass eine Person die angegebene E-Mail-Adresse besitzt. Für Passwort-zurücksetzen oder verifizierte E-Mail-Adressen muss zusätzlich ein sicherer E-Mail-Versanddienst eingerichtet werden.

Die Anwendung speichert E-Mail-Adresse, Passwort-Hash, Sitzungsdaten und abgeschlossene Lektionen. Informiere Nutzer:innen vor einer öffentlichen Nutzung über Zweck, Aufbewahrung und Löschung ihrer Daten und beachte die für deinen Betrieb geltenden Datenschutzanforderungen.
