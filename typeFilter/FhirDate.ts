import { Period } from "fhir/r4";
import moment, { Moment, unitOfTime } from "moment";

class TimeRange
{
    public start: Moment

    public end: Moment

    constructor(value: string | Period) {
        if (typeof value === "string") {
            const units: unitOfTime.Base[] = [
                "millisecond",
                "second",
                "minute",
                "hour",
                "day",
                "month",
                "year"
            ];

            const d = moment(value)
            
            let precision: unitOfTime.Base = "millisecond"

            for (const u of units) {
                if (d.get(u) > 0) break
                precision = u
            }

            this.start = d.startOf(precision)
            this.end   = d.endOf(precision)
        } else {
            this.start = moment(value.start)
            this.end   = moment(value.end)
        }
    }

    /**
     * the range of the parameter value fully contains the range of the resource
     * value
     */
    eq(x: TimeRange) {
        return x.start.isSame(this.start) && x.end.isSame(this.end)
    }

    /**
     * the range of the parameter value does not fully contain the range of the
     * resource value
     */
    ne(x: TimeRange) {
        return !x.start.isSame(this.start) || !x.end.isSame(this.end)
    }

    /**
     * the range above the parameter value intersects (i.e. overlaps) with the
     * range of the resource value
     */
    gt(x: TimeRange) {
        return this.end.isAfter(x.end)
    }

    /**
     * the range below the parameter value intersects (i.e. overlaps) with the
     * range of the resource value
     */
    lt(x: TimeRange) {
        return this.start.isBefore(x.start)
    }
    
    /**
     * the range above the parameter value intersects (i.e. overlaps) with the
     * range of the resource value, or the range of the parameter value fully
     * contains the range of the resource value
     */
    ge(x: TimeRange) {
        return this.end.isSameOrAfter(x.end)
    }

    /**
     * the range below the parameter value intersects (i.e. overlaps) with the
     * range of the resource value or the range of the parameter value fully
     * contains the range of the resource value
     */
    le(x: TimeRange) {
        return this.start.isSameOrBefore(x.start)
    }

    /**
     * the range of the parameter value does not overlap with the range of the
     * resource value, and the range above the parameter value contains the
     * range of the resource value
     */
    sa(x: TimeRange) {
        return this.start.isAfter(x.end)
    }

    /**
     * the range of the parameter value does not overlap with the range of the
     * resource value, and the range below the parameter value contains the
     * range of the resource value
     */
    eb(x: TimeRange) {
        return this.end.isBefore(x.start)
    }

    /**
     * the range of the parameter value overlaps with the range of the resource
     * value
     */
    ap(x: TimeRange) {
        return (
            Math.abs(x.start.diff(this.start)) <= moment().diff(this.start) * 0.1 &&
            Math.abs(x.end.diff(this.end)) <= moment().diff(this.end) * 0.1
        )
    }
}


export default class FhirDate {
    public range: TimeRange
    
    constructor(value: string | Period) {
        this.range = new TimeRange(value)
    }
    
    eq(x: FhirDate) {
        return this.range.eq(x.range)
    }
    
    ne(x: FhirDate) {
        return this.range.ne(x.range)
    }

    gt(x: FhirDate) {
        return this.range.gt(x.range)
    }

    lt(x: FhirDate) {
        return this.range.lt(x.range)
    }

    ge(x: FhirDate) {
        return this.range.ge(x.range)
    }

    le(x: FhirDate) {
        return this.range.le(x.range)
    }

    sa(x: FhirDate) {
        return this.range.sa(x.range)
    }

    eb(x: FhirDate) {
        return this.range.eb(x.range)
    }

    ap(x: FhirDate) {
        return this.range.ap(x.range)
    }
}