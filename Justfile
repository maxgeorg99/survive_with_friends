database := "survive-with-friends"

all: server

server: bindings publish

bindings:
	spacetime generate --lang typescript --out-dir ./client/src/autobindings --project-path server-rust

publish:
	spacetime publish -c -y -p server-rust {{database}}
