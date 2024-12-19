import { Reference } from "fhir/r4";

export default class FhirReference
{
    public value;

    constructor(value: Reference) {
        this.value = value
    }

    match(parameterValue: string, modifier?: string): boolean {

        if (modifier) {
            switch (modifier) {
                case "code-text":
                    return this.codeText(parameterValue)
                case "text":
                    return this.text(parameterValue)
                case "identifier":
                    return this.identifier(parameterValue)
                default:
                    throw new Error(`Unsupported search modifier "${modifier}" for reference fields`);
            }
        }

        if (parameterValue.includes("|")) {
            const [type, id] = parameterValue.split("|").map(s => s.trim())
            this.value.reference === [type, id].join("/")
        }

        if (!parameterValue.includes("/")) {
            const id = this.value.reference?.split("/").pop()!.trim()
            return !!id && id === parameterValue
        }

        return this.value.reference === parameterValue
    }

    codeText(parameterValue: string) {
        return this.value.display === parameterValue
    }

    identifier(parameterValue: string) {
        return this.value.identifier === parameterValue
    }

    text(parameterValue: string) {
        return this.value.display?.toLowerCase() === parameterValue.toLowerCase()
    }
}