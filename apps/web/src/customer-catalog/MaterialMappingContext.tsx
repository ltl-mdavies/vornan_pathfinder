import {createContext,useContext} from 'react';
import type {MaterialMappings} from '@pathfinder/catalog-domain/material-mapping';
export const MaterialMappingContext=createContext<MaterialMappings>([]);
export const useMaterialMappings=()=>useContext(MaterialMappingContext);
