#!/bin/sh
# Runs the Folio server and Caddy (web app + reverse proxy) together. The
# container stops when Caddy stops or the server fails; a server with every
# service switched off exits cleanly and leaves Caddy serving the web app.
set -u
cd /app

/app/httpserver &
server=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy=$!

stop() {
	kill -TERM "$caddy" ${server:+"$server"} 2>/dev/null
	wait
	exit 0
}
trap stop TERM INT

while kill -0 "$caddy" 2>/dev/null; do
	if [ -n "$server" ] && ! kill -0 "$server" 2>/dev/null; then
		wait "$server"
		code=$?
		server=""
		if [ "$code" -ne 0 ]; then
			echo "Folio server exited with code $code" >&2
			kill -TERM "$caddy" 2>/dev/null
			wait
			exit "$code"
		fi
	fi
	sleep 2
done
wait "$caddy"
exit $?
