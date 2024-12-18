import AllergyIntoleranceSchema  from "./AllergyIntolerance"
import CarePlanSchema            from "./CarePlan"
import CareTeamSchema            from "./CareTeam"
import ConditionSchema           from "./Condition"
import DiagnosticReportSchema    from "./DiagnosticReport"
import DocumentReferenceSchema   from "./DocumentReference"
import EncounterSchema           from "./Encounter"
import GroupSchema               from "./Group"
import MedicationRequestSchema   from "./MedicationRequest"
import ObservationSchema         from "./Observation"
import OrganizationSchema        from "./Organization"
import PatientSchema             from "./Patient"
import PractitionerSchema        from "./Practitioner"
import ProcedureSchema           from "./Procedure"
import OperationDefinitionSchema from "./OperationDefinition"


export interface SearchParamConfig {
    name: string
    type: "reference"|"string"|"token"|"uri"|"quantity"|"date"|"number"
    documentation?: string
    resolver?: (res: any) => any
}

export interface ResourceConfig {
    searchParam: SearchParamConfig[]
}

export interface SchemaInterface {
    [resourceType: string]: ResourceConfig
}

const schema: SchemaInterface = {
    AllergyIntolerance : AllergyIntoleranceSchema  as ResourceConfig,
    CarePlan           : CarePlanSchema            as ResourceConfig,
    CareTeam           : CareTeamSchema            as ResourceConfig,
    Condition          : ConditionSchema           as ResourceConfig,
    DiagnosticReport   : DiagnosticReportSchema    as ResourceConfig,
    DocumentReference  : DocumentReferenceSchema   as ResourceConfig,
    Encounter          : EncounterSchema           as ResourceConfig,
    Group              : GroupSchema               as ResourceConfig,
    MedicationRequest  : MedicationRequestSchema   as ResourceConfig,
    Observation        : ObservationSchema         as ResourceConfig,
    Organization       : OrganizationSchema        as ResourceConfig,
    Patient            : PatientSchema             as ResourceConfig,
    Practitioner       : PractitionerSchema        as ResourceConfig,
    Procedure          : ProcedureSchema           as ResourceConfig,
    OperationDefinition: OperationDefinitionSchema as ResourceConfig,
}

export default schema