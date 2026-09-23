package sqlite

import "time"

func timeToNullableString(v *time.Time) any {
	if v == nil {
		return nil
	}
	return v.UTC().Format(timeLayoutRFC3339())
}
