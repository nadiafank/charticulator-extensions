// The main file for the visual

(function (powerbi) {
    if (powerbi.visuals == undefined) powerbi.visuals = {};
    if (powerbi.extensibility == undefined) powerbi.extensibility = {};
    if (powerbi.extensibility.visual == undefined) powerbi.extensibility.visual = {};
    if (powerbi.visuals.plugins == undefined) powerbi.visuals.plugins = {};
    powerbi.visuals.plugins['<%= pluginName %>'] = {
        name: '<%= pluginName %>',
        displayName: '<%= visualDisplayName %>',
        class: 'CharticulatorPowerBIVisual',
        version: '<%= visualVersion %>',
        apiVersion: '<%= apiVersion %>',
        create: (options) => {
            return new powerbi.extensibility.visual['<%= visualGuid %>'].CharticulatorPowerBIVisual(options);
        },
        custom: true
    };

    let isInitialized = false;
    let initializeCallbacks = [];

    function runAfterInitialized(f) {
        if (isInitialized) {
            f();
        } else {
            initializeCallbacks.push(f);
        }
    }

    CharticulatorContainer.initialize({
        MapService: null
    }).then(() => {
        isInitialized = true;
        initializeCallbacks.forEach(f => f());
    });

    class CharticulatorPowerBIVisual {
        constructor(options) {
            try {
                this.template = '<%= templateData %>';
                this.canvas = document.createElement("canvas");
                this.properties = {};
                options.element.appendChild(this.canvas);
                this.chartTemplate = new CharticulatorContainer.ChartTemplate(this.template);
                this.chartInstance = null;
                for (let id in this.template.properties) {
                    if (!this.template.properties.hasOwnProperty(id)) continue;
                    for (let p of this.template.properties[id]) {
                        this.properties[p.name] = p.default;
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }

        getPixelRatio() {
            // FIXME: window.devicePixelRatio result in IllegalInvocation error in PowerBI visuals.
            // We fix this to 2 for now
            return 2;
        }

        resize(width, height) {
            this.canvas.style.width = width + "px";
            this.canvas.style.height = height + "px";
            let pr = this.getPixelRatio();
            this.canvas.width = Math.ceil(width * pr);
            this.canvas.height = Math.ceil(height * pr);
            let ctx = this.canvas.getContext("2d");
            ctx.setTransform(pr, 0, 0, pr, 0, 0);
        }

        /** Get a Charticulator dataset from the options */
        getDataset(options) {
            if (!options.dataViews
                || !options.dataViews[0]
                || !options.dataViews[0].categorical
                || !options.dataViews[0].categorical.categories
                || !options.dataViews[0].categorical.categories[0]) {
                return null;
            }
            let dv = options.dataViews[0];
            let category = dv.categorical.categories[0];
            let values = dv.categorical.values;
            if (!values) return null;

            let slotToValues = {};

            for (let slot of this.template.dataSlots) {
                let found = false;
                for (let v of values) {
                    if (v.source.roles[slot.powerBIName]) {
                        slotToValues[slot.powerBIName] = v;
                        found = true;
                    }
                }
                if (!found) return null;
            }
            let dataset = {
                name: "Dataset",
                tables: [{
                    name: "default",
                    columns: [
                        this.template.dataSlots.map(slot => {
                            return {
                                name: slot.powerBIName,
                                type: "any",
                                metadata: {
                                    kind: "any"
                                }
                            };
                        })
                    ],
                    rows: category.values.map((d, i) => {
                        let obj = {};
                        // ID is the category value
                        obj._id = "ID" + i.toString();
                        for (let slot of this.template.dataSlots) {
                            let value = slotToValues[slot.powerBIName].values[i];
                            if (value == null) return null;
                            obj[slot.powerBIName] = value.valueOf();
                            if (slot.kind == "categorical") {
                                obj[slot.powerBIName] = obj[slot.powerBIName].toString();
                            }
                        }
                        return obj;
                    }).filter(x => x != null)
                }]
            };
            return dataset;
        }

        getProperties(options) {
            let defaultProperties = {};
            for (let id in this.template.properties) {
                if (!this.template.properties.hasOwnProperty(id)) continue;
                for (let p of this.template.properties[id]) {
                    defaultProperties[p.name] = p.default;
                }
            }

            if (!options || !options.dataViews || !options.dataViews[0] || !options.dataViews[0].metadata) return defaultProperties;
            let objects = options.dataViews[0].metadata.objects;
            if (!objects) return defaultProperties;

            for (let id in this.template.properties) {
                if (!this.template.properties.hasOwnProperty(id)) continue;
                for (let p of this.template.properties[id]) {
                    let object = objects.chartOptions;
                    defaultProperties[p.name] = object[p.name];
                }
            }

            return defaultProperties;
        }

        clearCanvas() {
            let ctx = this.canvas.getContext("2d");
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        update(options) {
            runAfterInitialized(() => this.updateRun(options));
        }

        updateRun(options) {
            try {
                this.resize(options.viewport.width, options.viewport.height);
                this.clearCanvas();
                let ctx = this.canvas.getContext("2d");

                let dataset = this.getDataset(options);
                this.properties = this.getProperties(options);

                if (dataset == null) {
                    ctx.fillStyle = "black";
                    ctx.font = "24px Arial";
                    ctx.textAlign = "left";
                    ctx.fillText("Dataset incomplete. Please specify all data fields.", 20, 20);
                    this.currentDatasetJSON = null;
                    this.chartInstance = null;
                } else {
                    let datasetJSON = JSON.stringify(dataset);
                    if (datasetJSON != this.currentDatasetJSON) {
                        this.chartInstance = null;
                    }

                    if (!this.chartInstance) {
                        this.chartTemplate.reset();
                        for (let slot of this.template.dataSlots) {
                            this.chartTemplate.assignSlot(slot.name, slot.powerBIName);
                        }
                        for (let table of this.template.tables) {
                            this.chartTemplate.assignTable(table.name, "default");
                        }
                        this.chartInstance = this.chartTemplate.instantiate(dataset);
                    }

                    if (this.chartInstance) {
                        // Feed in properties
                        for (let id in this.template.properties) {
                            if (!this.template.properties.hasOwnProperty(id)) continue;
                            for (let p of this.template.properties[id]) {
                                let value = this.properties[p.name];
                                if (value == null) value = p.default;
                                let object = this.chartTemplate.findObjectById(this.chartInstance.chart, id);
                                switch (p.mode) {
                                    case "attribute": {
                                        object.mappings[p.attribute] = { type: "value", value: value };
                                    } break;
                                    case "property": {
                                        if (p.fields) {
                                            CharticulatorContainer.setField(object.properties[p.property], p.fields, value);
                                        } else {
                                            object.properties[p.property] = value;
                                        }
                                    }
                                }
                            }
                        }

                        this.chartInstance.resize(options.viewport.width, options.viewport.height);
                        this.chartInstance.update();
                        this.chartInstance.render(ctx);
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }

        enumerateObjectInstances(options) {
            let objectName = options.objectName;
            let objectEnumeration = [];
            switch (objectName) {
                case 'chartOptions':
                    objectEnumeration.push({
                        objectName: objectName,
                        properties: this.properties,
                        selector: null
                    });
            };
            return objectEnumeration;
        }
    }

    powerbi.extensibility.visual['<%= visualGuid %>'] = {
        CharticulatorPowerBIVisual: CharticulatorPowerBIVisual
    };

})(powerbi);