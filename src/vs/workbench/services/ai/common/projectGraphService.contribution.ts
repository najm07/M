/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IProjectGraphService } from '../../../../services/ai/common/projectGraphService.js';
import { ProjectGraphService } from '../../../../services/ai/node/projectGraphServiceImpl.js';

registerSingleton(IProjectGraphService, ProjectGraphService, InstantiationType.Delayed);

