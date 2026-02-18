package secrets

import "switchly/internal/model"

type Store interface {
	Put(accountID string, secrets model.AuthSecrets) error
	Get(accountID string) (model.AuthSecrets, error)
	Delete(accountID string) error
}
