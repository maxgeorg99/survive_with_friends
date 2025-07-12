module := "vibe-survivors-with-friends"

server:
    spacetime publish -p ./server-rust {{module}} -y -c

delete:
    spacetime delete {{module}} -y

client:
    npm start --prefix ./client

bindings:
    spacetime generate --lang typescript --out-dir ./client/src/autobindings --project-path server-rust 

all: server bindings client