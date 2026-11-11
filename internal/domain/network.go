package domain

import (
	"fmt"
	"regexp"
)

var networkRoutePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func ValidateNetworkRouteID(id string) error {
	if id != "" && !networkRoutePattern.MatchString(id) {
		return fmt.Errorf("invalid network route id")
	}
	return nil
}

type NetworkRoute struct {
	ID             string   `json:"id"`
	Label          string   `json:"label"`
	Available      bool     `json:"available"`
	SupportedTypes []string `json:"supportedTypes"`
	Scope          string   `json:"scope"`
}
type NodeNetworkRoutes struct {
	Enabled                bool           `json:"enabled"`
	NetworkRoutesSupported bool           `json:"networkRoutesSupported"`
	Routes                 []NetworkRoute `json:"routes"`
}
type NetworkObservation struct {
	Host       string   `json:"host"`
	Chains     []string `json:"chains"`
	Rule       string   `json:"rule"`
	ObservedAt string   `json:"observedAt"`
}
type NetworkPlan struct {
	State   string `json:"state"`
	RouteID string `json:"routeId,omitempty"`
	Label   string `json:"label"`
	Scope   string `json:"scope"`
}
type NetworkRoutesResponse struct {
	Enabled   bool                 `json:"enabled"`
	CanSelect bool                 `json:"canSelect"`
	NodeID    string               `json:"nodeId"`
	Planned   NetworkPlan          `json:"planned"`
	Routes    []NetworkRoute       `json:"routes"`
	Observed  []NetworkObservation `json:"observed"`
	CheckedAt string               `json:"checkedAt"`
	Message   string               `json:"message,omitempty"`
}
