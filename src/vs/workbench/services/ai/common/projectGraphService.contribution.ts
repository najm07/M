/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IProjectGraphService } from '../../../../services/ai/common/projectGraphService.js';
import { ProjectGraphService } from '../../../../services/ai/node/projectGraphServiceImpl.js';

// Use SyncDescriptor to handle optional ITreeSitterLibraryService parameter
registerSingleton(IProjectGraphService, new SyncDescriptor(ProjectGraphService, [], true));

