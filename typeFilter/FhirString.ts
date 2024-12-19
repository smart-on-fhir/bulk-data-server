
export default class FhirString
{
    protected value: string;

    constructor(value: string) {
        this.value = value
    }

    match(parameterValue: string, modifier = "exact") {
        switch (modifier) {
            case "contains":
                return this.value.toLowerCase().includes(parameterValue.toLowerCase());
            case "exact":
                return this.value === parameterValue;
            case "text":
                return this.value.toLowerCase() === parameterValue.toLowerCase();
            default:
                throw new Error(`Unsupported search modifier "${modifier}" for string fields`);
        }
    }
}