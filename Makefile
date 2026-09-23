DMS_DIR ?= ../dms

.PHONY: help run test lint ui-install ui-build deploy deploy-fast dms-deploy

help:
	@echo "Available targets: run, test, lint, ui-install, ui-build, deploy, deploy-fast, dms-deploy"

run:
	ROUTERD_SQLITE_PATH=./router.db go run ./cmd/routerd -config deploy/config.example.yml

test:
	go test ./...

lint:
	go test ./... -run TestDoesNotExist

ui-install:
	npm install --prefix web/ui

ui-build:
	npm run build --prefix web/ui

deploy:
	./scripts/deploy-routerd.sh

deploy-fast:
	./scripts/deploy-routerd-fast.sh

dms-deploy:
	$(MAKE) -C $(DMS_DIR) build
	set -a; . ./scripts/deploy-routerd.env; set +a; \
	DMS_ROUTER_PASSWORD="$$ROUTER_PASSWORD" $(DMS_DIR)/bin/dms-client apply \
		--config ./dms.yml \
		--service-bin $(DMS_DIR)/bin/dms-service-linux-arm64
