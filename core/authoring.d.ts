import type {DesignDocument,ElementNode,ResourceResolver} from './index.js';
export interface ResourceReference {documentId:string;nodeId:string;property:string;kind:'StaticResource'|'DynamicResource'}
export declare function propertyObject(node:ElementNode,key:string):ElementNode|undefined;
export declare function replaceObject(node:ElementNode,key:string,value:ElementNode|null):void;
export declare function setLiteral(node:ElementNode,key:string,value:unknown):void;
export declare function textTarget(node:ElementNode):{key:string;value:string}|null;
export declare function setText(node:ElementNode,value:string):void;
export declare function fourValues(value:unknown):number[]|null;
export declare function colorParts(value:unknown):{rgb:string;alpha:number}|null;
export declare function argb(rgb:string,alpha?:number):string;
export declare function resourceReferences(documents:DesignDocument[],resource:ElementNode,resolver?:ResourceResolver):ResourceReference[];
export declare function renameResource(documents:DesignDocument[],documentId:string,resourceId:string,key:string,resolver?:ResourceResolver):{documents:DesignDocument[];references:number};
export declare function inverseVector(matrix:{a:number;b:number;c:number;d:number},x:number,y:number):{x:number;y:number};
