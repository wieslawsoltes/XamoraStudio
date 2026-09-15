import type {DesignDocument,ElementNode} from './index.js';
export interface SolutionModel {version:1;id:string;name:string;folders:string[];startupId:string|null}
export declare function normalizePath(path:string):string;
export declare function filePath(document:DesignDocument):string;
export declare function resolvePath(source:string,owner?:string):string|null;
export declare function relativePath(target:string,owner:string):string;
export declare function createSolution(documents:DesignDocument[],metadata?:Partial<SolutionModel>):SolutionModel;
export declare function validateSolution(documents:DesignDocument[],solution:SolutionModel):SolutionModel;
export declare function moveSolutionPath(documents:DesignDocument[],solution:SolutionModel,from:string,to:string):{documents:DesignDocument[];solution:SolutionModel};
export declare function resolveDictionary(documents:DesignDocument[],source:string,owner:DesignDocument|string):ElementNode|null;
