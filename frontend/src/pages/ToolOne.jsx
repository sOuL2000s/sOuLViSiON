export default function ToolOne() {
    return (
        <div style={{ padding: '2rem' }}>
            <h1>Tool One</h1>
            <p>This is a protected tool page. Only logged-in users see this.</p>
            <div style={{ border: '1px dashed #ccc', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                [ Tool Functionality Goes Here ]
            </div>
        </div>
    );
}