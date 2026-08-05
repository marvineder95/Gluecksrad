.PHONY: db-up db-down run build fmt test

# Lokale Dev-Datenbank (Docker)
db-up:
	docker compose up -d

db-down:
	docker compose down

# Server lokal starten (nutzt Defaults aus config.go -> Docker-DB auf :5433)
run:
	go run ./cmd/api

build:
	go build -o bin/api ./cmd/api

fmt:
	gofmt -w .

test:
	go test ./...
