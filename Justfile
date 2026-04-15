module := "vibe-survivors-with-friends"

server:
    spacetime publish {{module}} --server local --module-path ./server-rust -y

server-clean:
    spacetime publish {{module}} --server local --module-path ./server-rust --clear-database -y

delete:
    spacetime delete {{module}} --server local -y

client:
    npm start --prefix ./client

bindings:
    spacetime generate --lang typescript --out-dir ./client/src/autobindings --module-path ./server-rust

logs:
    spacetime logs {{module}} --server local

all: server bindings client