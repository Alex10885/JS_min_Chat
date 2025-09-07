#!/bin/bash
echo "Committing without hooks..."
git commit --no-verify "$@"