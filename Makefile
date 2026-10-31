COMPOSE ?= docker compose

.PHONY: docker-build docker-up docker-down docker-logs

docker-build:
	$(COMPOSE) build

docker-up:
	$(COMPOSE) up --build -d

docker-down:
	$(COMPOSE) down

docker-logs:
	$(COMPOSE) logs -f pi-web
