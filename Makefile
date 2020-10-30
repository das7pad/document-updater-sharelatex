# This file was auto-generated, do not edit it directly.
# Instead run bin/update_build_scripts from
# https://github.com/das7pad/sharelatex-dev-env

ifneq (,$(wildcard .git))
git = git
else
# we are in docker, without the .git directory
git = sh -c 'false'
endif

PWD ?= $(shell pwd)
SUDO_UID ?= $(shell id -u)
SUDO_GID ?= $(shell id -g)

export BUILD_NUMBER ?= local
export BRANCH_NAME ?= $(shell $(git) rev-parse --abbrev-ref HEAD || echo master)
export COMMIT ?= $(shell $(git) rev-parse HEAD || echo HEAD)
export RELEASE ?= \
	$(shell $(git) describe --tags || echo v0.0.0 | sed 's/-g/+/;s/^v//')
export PROJECT_NAME = document-updater
export BUILD_DIR_NAME = $(shell pwd | xargs basename | tr -cd '[a-zA-Z0-9_.\-]')
DOCKER_COMPOSE_FLAGS ?= -f docker-compose.yml
DOCKER_COMPOSE := docker-compose $(DOCKER_COMPOSE_FLAGS)

export DOCKER_REGISTRY ?= local
export SHARELATEX_DOCKER_REPOS ?= $(DOCKER_REGISTRY)/sharelatex

export IMAGE_NODE ?= $(DOCKER_REGISTRY)/node:14.15.0
export IMAGE_PROJECT ?= $(SHARELATEX_DOCKER_REPOS)/$(PROJECT_NAME)
export IMAGE_BRANCH ?= $(IMAGE_PROJECT):$(BRANCH_NAME)
export IMAGE ?= $(IMAGE_BRANCH)-$(BUILD_NUMBER)

export IMAGE_BRANCH_DEV ?= $(IMAGE_PROJECT):dev
export IMAGE_CACHE_COLD ?= $(IMAGE_BRANCH_DEV)
export IMAGE_CACHE_HOT ?= $(IMAGE_BRANCH)

SUFFIX ?=
export IMAGE_CI ?= ci/$(PROJECT_NAME):$(BRANCH_NAME)-$(BUILD_NUMBER)$(SUFFIX)

clean_ci: clean
clean_ci: clean_build

clean_build: clean_docker_images
clean_docker_images:
	docker rmi \
		$(IMAGE_CI)-base \
		$(IMAGE_CI)-dev-deps \
		$(IMAGE_CI)-dev \
		$(IMAGE_CI)-prod \
		$(IMAGE_CI)-dev-deps-cache \
		$(IMAGE_CI)-prod-cache \
		--force

clean:

test: lint
lint:
test: format
format:

LINT_RUNNER_IMAGE ?= \
	$(SHARELATEX_DOCKER_REPOS)/lint-runner:2.0.4
LINT_RUNNER = \
	docker run \
		--rm \
		--tty \
		--volume $(PWD):$(PWD) \
		--workdir $(PWD) \
		--user $(SUDO_UID):$(SUDO_GID) \
		$(LINT_RUNNER_IMAGE)

GIT_PREVIOUS_SUCCESSFUL_COMMIT ?= $(shell \
	$(git) rev-parse --abbrev-ref --symbolic-full-name dev@{u} 2>/dev/null \
	| grep -e /dev \
	|| echo origin/dev)

NEED_FULL_LINT ?= \
	$(shell $(git) diff $(GIT_PREVIOUS_SUCCESSFUL_COMMIT) --name-only \
			| grep --max-count=1 \
				-e .eslintignore \
				-e .eslintrc \
				-e buildscript.txt \
	)

ifeq (,$(NEED_FULL_LINT))
lint: lint_partial
else
lint: lint_full
endif

RUN_LINT ?= $(LINT_RUNNER) eslint
lint_full:
	$(RUN_LINT) .

GIT_DIFF_CMD_FORMAT ?= \
	$(git) diff $(GIT_PREVIOUS_SUCCESSFUL_COMMIT) --name-only \
	| grep --invert-match \
		-e vendor \
	| grep \
		-e '\.js$$' \
	| sed 's|^|$(PWD)/|'

FILES_FOR_FORMAT ?= $(wildcard $(shell $(GIT_DIFF_CMD_FORMAT)))
FILES_FOR_LINT ?= $(FILES_FOR_FORMAT)

lint_partial:
ifneq (,$(FILES_FOR_LINT))
	$(RUN_LINT) $(FILES_FOR_LINT)
endif

NEED_FULL_FORMAT ?= \
	$(shell $(git) diff $(GIT_PREVIOUS_SUCCESSFUL_COMMIT) --name-only \
			| grep --max-count=1 \
				-e .prettierignore \
				-e .prettierrc \
				-e buildscript.txt \
	)

ifeq (,$(NEED_FULL_FORMAT))
format: format_partial
format_fix: format_fix_partial
else
format: format_full
format_fix: format_fix_full
endif

RUN_FORMAT ?= $(LINT_RUNNER) prettier-eslint
format_full:
	$(RUN_FORMAT) '$(PWD)/**/*.{js,less}' --list-different
format_fix_full:
	$(RUN_FORMAT) '$(PWD)/**/*.{js,less}' --write

format_partial:
ifneq (,$(FILES_FOR_LINT))
	$(RUN_FORMAT) $(FILES_FOR_FORMAT) --list-different
endif
format_fix_partial:
ifneq (,$(FILES_FOR_LINT))
	$(RUN_FORMAT) $(FILES_FOR_FORMAT) --write
endif

UNIT_TEST_DOCKER_COMPOSE ?= \
	COMPOSE_PROJECT_NAME=unit_test_$(BUILD_DIR_NAME) $(DOCKER_COMPOSE)

test: test_unit
test_unit: test_unit_app
test_unit_app:
	$(UNIT_TEST_DOCKER_COMPOSE) run --rm test_unit
	$(MAKE) clean_test_unit_app

clean_ci: clean_test_unit
clean_test_unit: clean_test_unit_app
clean_test_unit_app:
	$(UNIT_TEST_DOCKER_COMPOSE) down --timeout 0

ACCEPTANCE_TEST_DOCKER_COMPOSE ?= \
	COMPOSE_PROJECT_NAME=acceptance_test_$(BUILD_DIR_NAME) $(DOCKER_COMPOSE)

test: test_acceptance
test_acceptance: test_acceptance_app
test_acceptance_run: test_acceptance_app_run
test_acceptance_app: clean_test_acceptance_app
test_acceptance_app: test_acceptance_app_run

test_acceptance_app_run:
	$(ACCEPTANCE_TEST_DOCKER_COMPOSE) run --rm test_acceptance
	$(MAKE) clean_test_acceptance_app

test_acceptance_app_run: test_acceptance_pre_run
test_acceptance_pre_run:

clean_ci: clean_test_acceptance
clean_test_acceptance: clean_test_acceptance_app
clean_test_acceptance_app:
	$(ACCEPTANCE_TEST_DOCKER_COMPOSE) down --volumes --timeout 0

build_app:

build_dev_deps: clean_build_artifacts
	docker build \
		--force-rm=true \
		--cache-from $(IMAGE_CI)-dev-deps-cache \
		--tag $(IMAGE_CI)-base \
		--target base \
		.

	docker build \
		--force-rm=true \
		--cache-from $(IMAGE_CI)-base \
		--cache-from $(IMAGE_CI)-dev-deps-cache \
		--tag $(IMAGE_CI)-dev-deps \
		--target dev-deps \
		.

build_dev: clean_build_artifacts
	docker build \
		--force-rm=true \
		--cache-from $(IMAGE_CI)-dev-deps \
		--tag $(IMAGE_CI)-dev \
		--target dev \
		.

build_prod: clean_build_artifacts
	docker build \
		--force-rm=true \
		--cache-from $(IMAGE_CI)-dev \
		--tag $(IMAGE_CI)-base \
		--target base \
		.

	docker run \
		--rm \
		--entrypoint tar \
		$(IMAGE_CI)-dev \
			--create \
			--gzip \
			app.js \
			app/js \
			app/lib \
			config \
		> build_artifacts.tar.gz

	docker build \
		--force-rm=true \
		--build-arg RELEASE=$(RELEASE) \
		--build-arg COMMIT=$(COMMIT) \
		--build-arg BASE=$(IMAGE_CI)-base \
		--cache-from $(IMAGE_CI)-base \
		--cache-from $(IMAGE_CI)-prod-cache \
		--tag $(IMAGE_CI)-prod \
		--file=Dockerfile.production \
		.

clean_build: clean_build_artifacts
clean_build_artifacts:
	rm -f build_artifacts.tar.gz

clean_ci: clean_output
clean_output:
ifneq (,$(wildcard output/* output/.*))
	docker run --rm \
		--volume $(PWD)/output:/home/node \
		--user node \
		--network none \
		$(IMAGE_NODE) \
		sh -c 'find /home/node -mindepth 1 | xargs rm -rfv'
	rm -rfv output
endif

pull_node:
	docker pull $(IMAGE_NODE)
	docker tag $(IMAGE_NODE) node:14.15.0

pull_cache_cold:
	docker pull $(IMAGE_CACHE_COLD)$(R_TARGET)
	docker tag $(IMAGE_CACHE_COLD)$(R_TARGET) $(IMAGE_CI)$(TARGET)-cache

pull_cache_hot:
	docker pull $(IMAGE_CACHE_HOT)$(R_TARGET)
	docker tag $(IMAGE_CACHE_HOT)$(R_TARGET) $(IMAGE_CI)$(TARGET)-cache

pull_cache:
	make pull_cache_hot || make pull_cache_cold || echo 'cache miss'

clean_pull_cache:
	docker rmi --force \
		$(IMAGE_CACHE_COLD)$(R_TARGET) \
		$(IMAGE_CACHE_HOT)$(R_TARGET) \

push_cache_hot:
	docker tag $(IMAGE_CI)$(TARGET) $(IMAGE_CACHE_HOT)$(R_TARGET)
	docker push $(IMAGE_CACHE_HOT)$(R_TARGET)

push_target:
	docker tag $(IMAGE_CI)$(TARGET) $(IMAGE)$(R_TARGET)
	docker push $(IMAGE)$(R_TARGET)

clean_push:
	docker rmi --force \
		$(IMAGE)$(R_TARGET) \
		$(IMAGE_CACHE_HOT)$(R_TARGET) \

prepare_ci_stage: build_dev_with_cache
build_dev_with_cache: pull_node
build_dev_with_cache:
	docker pull $(IMAGE)-dev-deps
	docker tag $(IMAGE)-dev-deps $(IMAGE_CI)-dev-deps
	$(MAKE) --no-print-directory build_dev

prepare_ci_stage: create_output
create_output:
	mkdir --parents --mode=777 output

clean_ci_stage: clean_output
clean_ci_stage: clean_stage_images
clean_stage_images:
	docker rmi --force \
		$(IMAGE)-dev-deps \
		$(IMAGE_CI)-dev-deps \
		$(IMAGE_CI)-dev \

.PHONY: clean test test_unit test_acceptance test_clean build
